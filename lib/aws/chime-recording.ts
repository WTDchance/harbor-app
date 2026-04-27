// lib/aws/chime-recording.ts
//
// Wave 42 / T5 — Chime Media Pipelines start/stop helpers.
// Distinct from lib/aws/chime.ts (meeting create/delete) so the
// recording surface stays isolated and a misconfigured KMS key
// doesn't break plain meetings.

import {
  ChimeSDKMediaPipelinesClient,
  CreateMediaCapturePipelineCommand,
  DeleteMediaCapturePipelineCommand,
  GetMediaCapturePipelineCommand,
} from '@aws-sdk/client-chime-sdk-media-pipelines'

let _client: ChimeSDKMediaPipelinesClient | null = null
function client() {
  if (!_client) {
    _client = new ChimeSDKMediaPipelinesClient({
      region: process.env.CHIME_REGION || process.env.AWS_REGION || 'us-east-1',
    })
  }
  return _client
}

export interface StartRecordingResult {
  ok: boolean
  pipelineId?: string
  s3Bucket?: string
  s3KeyPrefix?: string
  error?: string
}

/**
 * Start a Chime Media Capture Pipeline for a live meeting.
 * Stores artifacts at s3://<bucket>/<keyPrefix>/.
 */
export async function startChimeRecording(args: {
  meetingArn: string  // Chime meetings ARN: arn:aws:chime::<acct>:meeting:<MeetingId>
  s3Bucket: string
  s3KeyPrefix: string
}): Promise<StartRecordingResult> {
  try {
    const res = await client().send(new CreateMediaCapturePipelineCommand({
      SourceType: 'ChimeSdkMeeting',
      SourceArn: args.meetingArn,
      SinkType: 'S3Bucket',
      SinkArn: `arn:aws:s3:::${args.s3Bucket}/${args.s3KeyPrefix}`,
    }))
    const pipeline = (res as any)?.MediaCapturePipeline ?? (res as any)?.mediaCapturePipeline
    return {
      ok: true,
      pipelineId: pipeline?.MediaPipelineId ?? pipeline?.MediaCapturePipelineId,
      s3Bucket: args.s3Bucket,
      s3KeyPrefix: args.s3KeyPrefix,
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function stopChimeRecording(args: {
  pipelineId: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await client().send(new DeleteMediaCapturePipelineCommand({
      MediaPipelineId: args.pipelineId,
    }))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function getChimeRecordingStatus(args: {
  pipelineId: string
}): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const res = await client().send(new GetMediaCapturePipelineCommand({
      MediaPipelineId: args.pipelineId,
    }))
    const status =
      (res as any)?.MediaCapturePipeline?.Status ??
      (res as any)?.mediaCapturePipeline?.status
    return { ok: true, status }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
