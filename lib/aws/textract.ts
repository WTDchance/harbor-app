// AWS Textract helpers for Harbor.
//
// Used by the insurance-card scanner (Wave 42) to OCR + form-parse the
// front/back of a patient's insurance card. We always call AnalyzeDocument
// with FeatureTypes=['FORMS'] for insurance cards — AnalyzeID is reserved
// for government IDs (driver's licence / passport) and does not understand
// payer cards.
//
// HIPAA: Textract is HIPAA-eligible under Harbor's existing AWS BAA.
// No image bytes leave AWS; we either pass S3 references or raw bytes
// over the AWS SDK's TLS connection inside the same account.

import {
  TextractClient,
  AnalyzeDocumentCommand,
  type Block,
  type AnalyzeDocumentResponse,
} from '@aws-sdk/client-textract'

let _client: TextractClient | null = null

function getClient(): TextractClient {
  if (!_client) {
    _client = new TextractClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })
  }
  return _client
}

export type AnalyzeFormsResult = {
  raw: AnalyzeDocumentResponse
  /** Map of (lower-cased KEY text) -> { value, confidence } */
  keyValues: Record<string, { value: string; confidence: number }>
  /** All raw LINE blocks (text + confidence) — used for regex-based
   *  payer / phone extraction when KEY/VALUE detection fails. */
  lines: Array<{ text: string; confidence: number }>
}

/**
 * Run AnalyzeDocument with FORMS on the supplied bytes. Returns a
 * normalised key/value map + the raw response.
 */
export async function analyzeFormsFromBytes(bytes: Uint8Array): Promise<AnalyzeFormsResult> {
  const cmd = new AnalyzeDocumentCommand({
    Document: { Bytes: bytes },
    FeatureTypes: ['FORMS'],
  })
  const resp = await getClient().send(cmd)
  return parseAnalyzeResponse(resp)
}

/**
 * Run AnalyzeDocument with FORMS against an object already in S3.
 * Useful when we've already uploaded the original; saves a re-upload.
 */
export async function analyzeFormsFromS3(args: {
  bucket: string
  key: string
}): Promise<AnalyzeFormsResult> {
  const cmd = new AnalyzeDocumentCommand({
    Document: {
      S3Object: {
        Bucket: args.bucket,
        Name: args.key,
      },
    },
    FeatureTypes: ['FORMS'],
  })
  const resp = await getClient().send(cmd)
  return parseAnalyzeResponse(resp)
}

// --- internal: walk the Block graph and stitch KEY/VALUE pairs ---

function parseAnalyzeResponse(resp: AnalyzeDocumentResponse): AnalyzeFormsResult {
  const blocks = resp.Blocks ?? []
  const byId = new Map<string, Block>()
  for (const b of blocks) if (b.Id) byId.set(b.Id, b)

  const keyValues: Record<string, { value: string; confidence: number }> = {}
  const lines: Array<{ text: string; confidence: number }> = []

  for (const b of blocks) {
    if (b.BlockType === 'LINE' && typeof b.Text === 'string') {
      lines.push({ text: b.Text, confidence: (b.Confidence ?? 0) / 100 })
    }
    if (b.BlockType !== 'KEY_VALUE_SET') continue
    if (!b.EntityTypes?.includes('KEY')) continue

    const keyText = collectChildText(b, byId)
    if (!keyText) continue

    // KEY blocks reference their VALUE via a Relationship of type "VALUE".
    const valueRel = b.Relationships?.find(r => r.Type === 'VALUE')
    if (!valueRel?.Ids?.length) continue

    const valueBlock = byId.get(valueRel.Ids[0])
    if (!valueBlock) continue

    const valueText = collectChildText(valueBlock, byId)
    if (!valueText) continue

    const conf = Math.min(b.Confidence ?? 0, valueBlock.Confidence ?? 0) / 100
    keyValues[keyText.toLowerCase().trim()] = {
      value: valueText.trim(),
      confidence: conf,
    }
  }

  return { raw: resp, keyValues, lines }
}

function collectChildText(block: Block, byId: Map<string, Block>): string {
  const childRel = block.Relationships?.find(r => r.Type === 'CHILD')
  if (!childRel?.Ids?.length) return ''
  const parts: string[] = []
  for (const id of childRel.Ids) {
    const child = byId.get(id)
    if (!child) continue
    if (child.BlockType === 'WORD' && typeof child.Text === 'string') {
      parts.push(child.Text)
    } else if (child.BlockType === 'SELECTION_ELEMENT' && child.SelectionStatus === 'SELECTED') {
      parts.push('[X]')
    }
  }
  return parts.join(' ').trim()
}
