// Anthropic Claude client and helpers for SMS conversation AI
// Used to generate conversational SMS responses using Claude Sonnet 4.6

import Anthropic from '@anthropic-ai/sdk'

const apiKey = process.env.ANTHROPIC_API_KEY || ''

if (!apiKey) {
  console.warn('⚠️ Anthropic API key not configured. SMS AI responses will fail.')
}

// Initialize Anthropic client
const client = apiKey
  ? new Anthropic({ apiKey })
  : null

/**
 * Generate an SMS response from Claude
 * Used when an inbound SMS arrives - Claude generates the reply
 *
 * @param userMessage - The incoming SMS message
 * @param systemPrompt - The SMS receptionist system prompt
 * @param conversationHistory - Previous messages in this conversation
 * @returns Generated response text
 */
export async function generateSMSResponse(
  userMessage: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<string> {
  if (!client) {
    console.warn('⚠️ Anthropic not configured - returning fallback message')
    return 'Thanks for your message! Our team will get back to you soon.'
  }

  try {
    // Build message array with conversation history
    const messages: Anthropic.Messages.MessageParam[] = [
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ]

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 150, // SMS should be concise
      messages: messages,
      system: systemPrompt,
    })

    // Extract text from response
    const textBlock = response.content.find((block) => block.type === 'text')
    if (textBlock && textBlock.type === 'text') {
      return textBlock.text.trim()
    }

    return 'Thanks for your message! Our team will get back to you soon.'
  } catch (error) {
    console.error('Error generating SMS response:', error)
    throw error
  }
}

/**
 * Generate a call summary from a transcript
 * Used after calls end to create a summary for staff
 *
 * @param transcript - The full call transcript
 * @param summaryPrompt - The summary generation prompt
 * @returns Generated summary text
 */
export async function generateCallSummary(
  transcript: string,
  summaryPrompt: string
): Promise<string> {
  if (!client) {
    console.warn('⚠️ Anthropic not configured - skipping summary generation')
    return 'Summary generation unavailable'
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `${summaryPrompt}\n\nTRANSCRIPT:\n${transcript}`,
        },
      ],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (textBlock && textBlock.type === 'text') {
      return textBlock.text.trim()
    }

    return 'Summary could not be generated'
  } catch (error) {
    console.error('Error generating call summary:', error)
    throw error
  }
}

/**
 * Extract structured information from a call transcript
 * Used to pull out key details like name, phone, insurance, etc.
 *
 * @param transcript - The call transcript
 * @returns Extracted information object
 */
export async function extractCallInformation(
  transcript: string
): Promise<{
  patientName?: string
  patientPhone?: string
  patientEmail?: string
  patientInsurance?: string
  reasonForSeeking?: string
  appointmentScheduled?: boolean
  appointmentTime?: string
  intakeDeliveryPreference?: string
}> {
  if (!client) {
    console.warn('⚠️ Anthropic not configured - skipping information extraction')
    return {}
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Extract the following information from this call transcript. If not mentioned, leave blank. Return in this exact JSON format:

{
  "patientName": "full name or blank",
  "patientPhone": "phone number or blank",
  "patientEmail": "email or blank",
  "patientInsurance": "insurance provider or blank",
  "reasonForSeeking": "reason for therapy or blank",
  "appointmentScheduled": true/false,
  "appointmentTime": "scheduled time or blank",
  "intakeDeliveryPreference": "sms or email or both or blank"
}

For intakeDeliveryPreference: if the caller says "text me", "send a text", or mentions their phone, put "sms". If they say "email me" or provide an email for forms, put "email". If they say both or don't specify, put "both". If not discussed, leave blank.

TRANSCRIPT:
${transcript}`,
        },
      ],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (textBlock && textBlock.type === 'text') {
      try {
        // Strip markdown code blocks if present
        let jsonText = textBlock.text.trim()
        const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1].trim()
        }
        return JSON.parse(jsonText)
      } catch {
        console.warn('Could not parse extracted information as JSON')
        return {}
      }
    }

    return {}
  } catch (error) {
    console.error('Error extracting call information:', error)
    throw error
  }
}

/**
 * Check if a message contains a crisis indicator
 * Used to flag messages that mention self-harm, suicide, abuse, etc.
 *
 * @param message - The message to check
 * @returns true if crisis language detected
 */
export async function detectCrisisIndicators(message: string): Promise<boolean> {
  if (!client) {
    console.warn('⚠️ Anthropic not configured - skipping crisis detection')
    return false
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: `Does this message contain language indicating a mental health crisis (suicide, self-harm, abuse, overdose, etc.)? Answer only YES or NO.

Message: "${message}"`,
        },
      ],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (textBlock && textBlock.type === 'text') {
      return textBlock.text.trim().toUpperCase().includes('YES')
    }

    return false
  } catch (error) {
    console.error('Error detecting crisis indicators:', error)
    return false
  }
}

/**
 * Count tokens in a message
 * Useful for staying within rate limits and controlling costs
 * Note: This is an approximation; use Anthropic's token counting API for exact counts
 *
 * @param text - Text to count
 * @returns Approximate token count
 */
export function approximateTokenCount(text: string): number {
  // Claude uses roughly 4 characters per token
  // This is a rough estimate for budgeting purposes
  return Math.ceil(text.length / 4)
}

/**
 * Format conversation history for Claude
 * Converts our internal format to Anthropic's message format
 *
 * @param messages - Array of {role, content} messages
 * @returns Formatted for Anthropic API
 */
export function formatConversationHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Anthropic.Messages.MessageParam[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }))
}

/**
 * Check if Claude is configured
 * Useful for graceful fallbacks when API key is missing
 */
export function isClaudeConfigured(): boolean {
  return !!client && !!apiKey
}

/**
 * Estimate cost of a call to Claude
 * Input: $3/million tokens, Output: $15/million tokens
 *
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @returns Cost in dollars
 */
export function estimateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1000000) * 3
  const outputCost = (outputTokens / 1000000) * 15
  return inputCost + outputCost
}
