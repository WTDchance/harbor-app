// TP-Link Kasa Cloud API integration for smart device control
// Used for patient check-in notifications (e.g., turn on a light/plug when patient arrives)
// Uses TP-Link's cloud API — works over the internet, no local network access needed

const TPLINK_CLOUD_URL = 'https://wap.tplinkcloud.com'

interface TPLinkDevice {
  deviceId: string
  deviceName: string
  deviceType: string
  deviceModel: string
  alias: string
  status: number // 0 = off, 1 = on
  appServerUrl: string
}

interface TPLinkSession {
  token: string
  devices: TPLinkDevice[]
}

// In-memory cache for TP-Link sessions (keyed by practice_id)
const sessionCache: Map<string, { token: string; expiry: number }> = new Map()

/**
 * Authenticate with TP-Link Cloud and get a token
 */
export async function tplinkLogin(email: string, password: string): Promise<string> {
  const termId = crypto.randomUUID()

  const response = await fetch(TPLINK_CLOUD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'login',
      params: {
        appType: 'Kasa_Android',
        cloudUserName: email,
        cloudPassword: password,
        terminalUUID: termId,
      },
    }),
  })

  const data = await response.json()

  if (data.error_code !== 0) {
    console.error('TP-Link login failed:', data)
    throw new Error(`TP-Link login failed: ${data.msg || 'Unknown error'} (code: ${data.error_code})`)
  }

  return data.result.token
}

/**
 * Get cached token or login fresh
 */
async function getToken(practiceId: string, email: string, password: string): Promise<string> {
  const cached = sessionCache.get(practiceId)
  if (cached && cached.expiry > Date.now()) {
    return cached.token
  }

  const token = await tplinkLogin(email, password)
  // Cache for 12 hours (TP-Link tokens last ~24h)
  sessionCache.set(practiceId, { token, expiry: Date.now() + 12 * 60 * 60 * 1000 })
  return token
}

/**
 * List all devices on the TP-Link account
 */
export async function listDevices(token: string): Promise<TPLinkDevice[]> {
  const response = await fetch(TPLINK_CLOUD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'getDeviceList',
    }),
    // Token goes as query param
  })

  // Actually TP-Link wants the token as a query param
  const url = `${TPLINK_CLOUD_URL}?token=${token}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'getDeviceList',
    }),
  })

  const data = await resp.json()

  if (data.error_code !== 0) {
    throw new Error(`Failed to list devices: ${data.msg || 'Unknown error'}`)
  }

  return data.result.deviceList || []
}

/**
 * Send a passthrough command to a specific device
 */
async function sendDeviceCommand(
  token: string,
  deviceId: string,
  appServerUrl: string,
  command: object
): Promise<any> {
  const url = `${appServerUrl}?token=${token}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'passthrough',
      params: {
        deviceId: deviceId,
        requestData: JSON.stringify(command),
      },
    }),
  })

  const data = await response.json()

  if (data.error_code !== 0) {
    throw new Error(`Device command failed: ${data.msg || 'Unknown error'}`)
  }

  // Parse the nested response
  if (data.result?.responseData) {
    return JSON.parse(data.result.responseData)
  }

  return data.result
}

/**
 * Turn a smart plug ON
 */
export async function turnOn(token: string, deviceId: string, appServerUrl: string): Promise<void> {
  await sendDeviceCommand(token, deviceId, appServerUrl, {
    system: { set_relay_state: { state: 1 } },
  })
  console.log(`✓ Kasa device ${deviceId} turned ON`)
}

/**
 * Turn a smart plug OFF
 */
export async function turnOff(token: string, deviceId: string, appServerUrl: string): Promise<void> {
  await sendDeviceCommand(token, deviceId, appServerUrl, {
    system: { set_relay_state: { state: 0 } },
  })
  console.log(`✓ Kasa device ${deviceId} turned OFF`)
}

/**
 * High-level: Trigger check-in notification on a practice's configured device
 * Turns the device ON, then schedules auto-OFF after the specified delay
 *
 * @param practiceId - The practice UUID
 * @param kasaEmail - TP-Link account email
 * @param kasaPassword - TP-Link account password
 * @param deviceAlias - Device name in Kasa app (e.g., "living room door")
 * @param autoOffMinutes - Minutes before auto-turning off (default 5)
 * @returns Object with success status and device info
 */
export async function triggerCheckinNotification(
  practiceId: string,
  kasaEmail: string,
  kasaPassword: string,
  deviceAlias: string,
  autoOffMinutes: number = 5
): Promise<{ success: boolean; deviceName?: string; error?: string }> {
  try {
    // Get or refresh token
    const token = await getToken(practiceId, kasaEmail, kasaPassword)

    // Find the device by alias
    const devices = await listDevices(token)
    const device = devices.find(
      (d) => d.alias.toLowerCase() === deviceAlias.toLowerCase()
    )

    if (!device) {
      const available = devices.map((d) => d.alias).join(', ')
      return {
        success: false,
        error: `Device "${deviceAlias}" not found. Available devices: ${available}`,
      }
    }

    // Turn ON
    await turnOn(token, device.deviceId, device.appServerUrl)

    // Schedule auto-OFF
    const offDelayMs = autoOffMinutes * 60 * 1000
    setTimeout(async () => {
      try {
        // Re-authenticate in case token expired (unlikely for 5-10 min but safe)
        const freshToken = await getToken(practiceId, kasaEmail, kasaPassword)
        await turnOff(freshToken, device.deviceId, device.appServerUrl)
        console.log(`✓ Kasa device "${device.alias}" auto-turned OFF after ${autoOffMinutes} minutes`)
      } catch (err) {
        console.error(`Failed to auto-turn off device "${device.alias}":`, err)
      }
    }, offDelayMs)

    console.log(
      `✓ Check-in notification: "${device.alias}" ON, auto-off in ${autoOffMinutes} min`
    )

    return { success: true, deviceName: device.alias }
  } catch (error: any) {
    console.error('Kasa check-in notification error:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Test the Kasa connection — used during practice setup
 * Verifies credentials and lists available devices
 */
export async function testConnection(
  email: string,
  password: string
): Promise<{ success: boolean; devices?: string[]; error?: string }> {
  try {
    const token = await tplinkLogin(email, password)
    const devices = await listDevices(token)
    return {
      success: true,
      devices: devices.map((d) => `${d.alias} (${d.deviceModel})`),
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
