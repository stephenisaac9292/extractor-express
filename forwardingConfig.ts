import fetch from "node-fetch";

export async function forwardToVM(
  vmUrl: string,
  pAuthorization: string,
  game: string,
  username: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!vmUrl) {
      return { success: false, error: "VM URL missing" };
    }

    if (!pAuthorization) {
      return { success: false, error: "pAuthorization missing" };
    }

    if (!game) {
      return { success: false, error: "Game type missing" };
    }

    if (!username) {
      return { success: false, error: "Username missing" };
    }

    console.log("🚀 Sending to VM:", vmUrl);

    const payload = {
      pAuthorization,
      game,
      username,
      timestamp: new Date().toISOString(),
    };

    console.log("📤 Payload:", {
      pAuthorization: pAuthorization.substring(0, 20) + "...",
      game,
      username,
      timestamp: payload.timestamp,
    });

    const response = await fetch(vmUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ VM returned ${response.status}:`, text);
      return {
        success: false,
        error: `VM error ${response.status}: ${text}`,
      };
    }

    console.log("✅ Successfully forwarded to VM");
    return { success: true };
  } catch (err: any) {
    console.error("❌ Forward error:", err.message);
    return { success: false, error: err.message };
  }
}