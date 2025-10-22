import express from "express";
import { chromium, devices } from "playwright";
import { networkInterfaces } from "os";
import { forwardToVM } from "./forwardingConfig";
import path from "path";

const app = express();
const PORT = 3000;

// Store extraction status
const sessions = new Map<string, { status: string; data?: any }>();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.static("public"));

// Serve index.html directly
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Test endpoint
app.get("/api/test", (req, res) => {
  res.json({ message: "API is working!" });
});

// Trigger extraction with credentials
app.post("/api/extract", async (req, res) => {
  try {
    console.log("📨 Received extraction request");
    console.log("Body:", req.body);
    
    const { username, password, game } = req.body;

    if (!username || !password) {
      console.log("❌ Missing credentials");
      return res.status(400).json({ error: "Username and password required" });
    }

    if (!game) {
      console.log("❌ Missing game selection");
      return res.status(400).json({ error: "Game selection required" });
    }

    const sessionId = Date.now().toString();
    sessions.set(sessionId, { status: "pending" });

    console.log(`✅ Session created: ${sessionId} for game: ${game}`);
    res.json({ sessionId, message: "Extraction started" });

    // Run extraction in background
    runExtraction(sessionId, username, password, game).catch((err) => {
      console.error("Extraction error:", err);
      sessions.set(sessionId, { status: "error", data: { error: err.message } });
    });
  } catch (error: any) {
    console.error("❌ API Error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// Check extraction status
app.get("/api/status/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json(session);
});

// Forward tokens to VM (called from frontend)
app.post("/api/forward", async (req, res) => {
  try {
    const { vmUrl, pAuthorization, game, vmUsername } = req.body;

    if (!vmUrl) {
      return res.status(400).json({ error: "VM URL required" });
    }

    if (!pAuthorization) {
      return res.status(400).json({ error: "Missing pAuthorization" });
    }

    if (!game) {
      return res.status(400).json({ error: "Missing game selection" });
    }

    if (!vmUsername) {
      return res.status(400).json({ error: "Missing username" });
    }

    console.log("🚀 Forwarding to VM:", vmUrl);

    const result = await forwardToVM(vmUrl, pAuthorization, game, vmUsername);

    if (result.success) {
      res.json({ success: true, vmUsed: vmUrl });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("❌ Forward error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function runExtraction(sessionId: string, username: string, password: string, game: string) {
  console.log(`🚀 Launching mobile browser for auto-login (Game: ${game})...`);

  // Game URL mapping
  const gameUrls: { [key: string]: string } = {
    madpunch: "https://www.msport.com/ng/casino/madpunch",
    superkick: "https://www.msport.com/ng/casino/superkick",
    skyace: "https://www.msport.com/ng/casino/sky-ace"
  };

  const gameUrl = gameUrls[game];
  if (!gameUrl) {
    throw new Error(`Invalid game selection: ${game}`);
  }

  const iPhone = devices["iPhone 13 Pro"];
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
    ],
  });

  const context = await browser.newContext({ 
    ...iPhone,
    locale: 'en-NG',
    timezoneId: 'Africa/Lagos',
  });
  const page = await context.newPage();

  const client = await context.newCDPSession(page);
  await client.send("Network.enable");

  let pAuthorization = "";
  let loginSuccessful = false;

  // Capture WebSocket
  client.on("Network.webSocketCreated", ({ url }) => {
    if (!url) return;
    console.log("🔌 WebSocket created:", url);

    const pAuthMatch = url.match(/[?&]pAuthorization=([^&]+)/);

    if (pAuthMatch?.[1]) {
      pAuthorization = pAuthMatch[1];
      console.log("✅ Captured pAuthorization!");
    }
  });

  // Listen for WebSocket requests
  context.on("request", (request) => {
    const url = request.url();
    if (url.includes("wss://")) {
      console.log("🔍 Found WebSocket URL:", url.substring(0, 100) + "...");
      const pAuthMatch = url.match(/[?&]pAuthorization=([^&]+)/);
      if (pAuthMatch?.[1]) pAuthorization = pAuthMatch[1];
    }
  });

  try {
    console.log("🌐 Opening login page...");
    await page.goto("https://www.msport.com/ng/sign_in", {
      waitUntil: "networkidle",
      timeout: 45000,
    });

    console.log("📝 Auto-filling credentials...");
    await page.waitForTimeout(4000);
    
    // Fill phone number
    try {
      console.log("🔍 Looking for phone input field...");
      
      let phoneFilled = false;
      
      // Method 1: Type tel
      try {
        const telInput = await page.locator('input[type="tel"]').first();
        if (await telInput.isVisible({ timeout: 5000 })) {
          await telInput.click();
          await page.waitForTimeout(800);
          await telInput.fill(username);
          console.log("✅ Phone filled via type=tel");
          phoneFilled = true;
        }
      } catch (e) {
        console.log("❌ Method 1 failed");
      }
      
      // Method 2: Name attribute
      if (!phoneFilled) {
        try {
          const nameInput = await page.locator('input[name*="phone"], input[name*="Phone"]').first();
          if (await nameInput.isVisible({ timeout: 5000 })) {
            await nameInput.click();
            await page.waitForTimeout(800);
            await nameInput.fill(username);
            console.log("✅ Phone filled via name attribute");
            phoneFilled = true;
          }
        } catch (e) {
          console.log("❌ Method 2 failed");
        }
      }
      
      // Method 3: First visible text input
      if (!phoneFilled) {
        try {
          const textInputs = await page.locator('input[type="text"]').all();
          for (const input of textInputs) {
            if (await input.isVisible()) {
              await input.click();
              await page.waitForTimeout(800);
              await input.fill(username);
              console.log("✅ Phone filled via first visible text input");
              phoneFilled = true;
              break;
            }
          }
        } catch (e) {
          console.log("❌ Method 3 failed");
        }
      }
      
      // Method 4: Any visible non-password input
      if (!phoneFilled) {
        try {
          const allInputs = await page.locator('input:not([type="password"])').all();
          for (const input of allInputs) {
            if (await input.isVisible()) {
              await input.click();
              await page.waitForTimeout(800);
              await input.fill(username);
              console.log("✅ Phone filled via any visible input");
              phoneFilled = true;
              break;
            }
          }
        } catch (e) {
          console.log("❌ Method 4 failed");
        }
      }
      
      if (!phoneFilled) {
        await page.screenshot({ path: 'login-page.png', fullPage: true });
        throw new Error("Could not find phone input field. Screenshot saved.");
      }
      
    } catch (error: any) {
      throw new Error(`Phone field error: ${error.message}`);
    }
    
    await page.waitForTimeout(1500);
    
    // Fill password
    try {
      console.log("🔑 Filling password...");
      const passwordInput = await page.locator('input[type="password"]').first();
      
      if (await passwordInput.isVisible({ timeout: 5000 })) {
        await passwordInput.click();
        await page.waitForTimeout(800);
        await passwordInput.fill(password);
        console.log("✅ Password filled");
      } else {
        throw new Error("Password field not visible");
      }
      
    } catch (error: any) {
      throw new Error(`Password field error: ${error.message}`);
    }
    
    await page.waitForTimeout(1500);
    
    console.log("🔐 Submitting login form...");
    
    const loginUrl = page.url();
    console.log("📍 Current URL before submit:", loginUrl);
    
    // Click login button
    try {
      let clicked = false;
      
      const buttonSelectors = [
        'button[type="submit"]',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
        'button:has-text("Log in")',
        'input[type="submit"]'
      ];
      
      for (const selector of buttonSelectors) {
        try {
          const button = await page.locator(selector).first();
          if (await button.isVisible()) {
            await button.click();
            console.log(`✅ Clicked login button: ${selector}`);
            clicked = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!clicked) {
        console.log("⌨️ Pressing Enter key...");
        await page.keyboard.press('Enter');
      }
      
    } catch (error: any) {
      console.log("⌨️ Button click failed, trying Enter key...");
      await page.keyboard.press('Enter');
    }

    console.log("⏳ Waiting for login to complete...");
    
    try {
      await page.waitForTimeout(3000);
      
      const currentUrl = page.url();
      console.log("📍 Current URL after submit:", currentUrl);
      
      if (currentUrl.toString().includes('sign_in')) {
        console.log("⏳ Still on login page, waiting for redirect...");
        
        await Promise.race([
          page.waitForURL(url => !url.toString().includes('sign_in'), { timeout: 30000 }),
          page.waitForSelector('[data-testid="user-menu"]', { timeout: 30000 }).catch(() => null),
          page.waitForSelector('.user-info', { timeout: 30000 }).catch(() => null),
        ]);
      }
      
      const cookies = await context.cookies();
      const hasAuthCookie = cookies.some(c => 
        c.name.toLowerCase().includes('token') || 
        c.name.toLowerCase().includes('auth') ||
        c.name.toLowerCase().includes('session')
      );
      
      if (hasAuthCookie) {
        console.log("✅ Auth cookie detected!");
        loginSuccessful = true;
      }
      
      await page.waitForTimeout(2000);
      const finalUrl = page.url();
      console.log("📍 Final URL:", finalUrl);
      
      if (!finalUrl.toString().includes('sign_in')) {
        console.log("✅ Login successful - URL changed!");
        loginSuccessful = true;
      }
      
      const errorMessages = await page.locator('[class*="error"], [class*="Error"]').count();
      if (errorMessages > 0) {
        const errorText = await page.locator('[class*="error"], [class*="Error"]').first().textContent();
        throw new Error(`Login failed: ${errorText}`);
      }
      
      if (!loginSuccessful) {
        await page.screenshot({ path: 'login-result.png', fullPage: true });
        console.log("⚠️ Could not confirm login success, but proceeding...");
      }
      
    } catch (error: any) {
      await page.screenshot({ path: 'login-error.png', fullPage: true });
      console.error("❌ Login verification error:", error.message);
      throw new Error(`Login timeout - credentials may be incorrect or network issue. Screenshot saved for debugging.`);
    }
    
    console.log("⏳ Waiting 5 seconds before navigating to game...");
    await page.waitForTimeout(5000);

    console.log(`🎰 Navigating to ${game}...`);
    await page.goto(gameUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait for game to load and select "amigos" variant
    console.log("🎮 Looking for 'amigos' game variant...");
    await page.waitForTimeout(3000);
    
    try {
      const amigosSelectors = [
        'button:has-text("amigos")',
        'button:has-text("Amigos")',
        'div:has-text("amigos")',
        '[data-game="amigos"]',
        '[class*="amigos"]',
        'text=amigos',
        'text=Amigos'
      ];
      
      let amigosClicked = false;
      for (const selector of amigosSelectors) {
        try {
          const element = await page.locator(selector).first();
          if (await element.isVisible({ timeout: 2000 })) {
            await element.click();
            console.log(`✅ Clicked amigos variant using: ${selector}`);
            amigosClicked = true;
            await page.waitForTimeout(2000);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!amigosClicked) {
        console.log("⚠️ Could not find 'amigos' button - using default variant");
        await page.screenshot({ path: `${game}-variants.png`, fullPage: true });
      }
    } catch (error: any) {
      console.log("⚠️ Error selecting amigos variant:", error.message);
    }

    // Wait for WebSocket
    console.log("⏳ Waiting for WebSocket data...");
    let wsAttempts = 0;
    while (!pAuthorization && wsAttempts < 900) {
      wsAttempts++;
      await page.waitForTimeout(100);
      if (wsAttempts % 50 === 0)
        console.log(`   Still waiting... (${wsAttempts / 10}s)`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("🎯 EXTRACTED DATA:");
    console.log("=".repeat(60));
    console.log("\n🔑 pAuthorization:", pAuthorization || "❌ Not captured");
    console.log("\n" + "=".repeat(60));

    // Validate we have the required data
    if (!pAuthorization) {
      throw new Error("Failed to capture WebSocket credentials (pAuthorization missing)");
    }

    // Update session with results
    sessions.set(sessionId, {
      status: "completed",
      data: {
        pAuthorization,
      },
    });

    console.log("✅ Extraction complete! Browser closes in 5 seconds...");
    await page.waitForTimeout(5000);
    await browser.close();
    
  } catch (error: any) {
    console.error("❌ Error during extraction:", error.message);
    await browser.close();
    sessions.set(sessionId, {
      status: "error",
      data: { error: error.message || "Login failed" },
    });
  }
}

function getLocalIpAddress(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const netArray = nets[name];
    if (!netArray) continue;
    for (const net of netArray) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log("\n" + "=".repeat(60));
  console.log("🚀 Server is running!");
  console.log("=".repeat(60));
  console.log(`📍 Local:    http://localhost:${PORT}`);
  console.log(`📍 Network:  http://${localIp}:${PORT}`);
  console.log("=".repeat(60));
  console.log("💡 Share the Network URL with users on same WiFi");
  console.log("=".repeat(60) + "\n");
});