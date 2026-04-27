// lib/aws/chime.ts
// Wave 38 TS2 — AWS Chime SDK Meetings server helpers.
//
// HIPAA: Chime SDK Meetings is BAA-covered. Meeting metadata contains
// no PHI -- only Harbor's opaque ExternalMeetingId (we use the
// appointment uuid). The server side stitches MeetingId <-> appointment
// behind requireEhrApiSession() so the link itself doesn't expose
// patient info.

import {
  ChimeSDKMeetingsClient,
  CreateMeetingCommand,
  CreateAttendeeCommand,
  DeleteMeetingCommand,
  GetMeetingCommand,
} from '@aws-sdk/client-chime-sdk-meetings'

let _client: ChimeSDKMeetingsClient | null = null
function client() {
  if (!_client) {
    _client = new ChimeSDKMeetingsClient({
      region: process.env.CHIME_REGION || process.env.AWS_REGION || 'us-east-1',
    })
  }
  return _client
}

export type ChimeJoin = {
  meeting: any
  attendee: any
}

export async function createChimeMeeting(args: {
  externalMeetingId: string
  region?: string
}): Promise<any> {
  const r = await client().send(new CreateMeetingCommand({
    ClientRequestToken: args.externalMeetingId.slice(0, 64),
    ExternalMeetingId: args.externalMeetingId.slice(0, 64),
    MediaRegion: args.region || process.env.CHIME_REGION || 'us-east-1',
    NotificationsConfiguration: {},
  }))
  return r.Meeting
}

export async function getChimeMeeting(meetingId: string): Promise<any | null> {
  try {
    const r = await client().send(new GetMeetingCommand({ MeetingId: meetingId }))
    return r.Meeting || null
  } catch {
    return null
  }
}

export async function createChimeAttendee(args: {
  meetingId: string
  externalUserId: string
}): Promise<any> {
  const r = await client().send(new CreateAttendeeCommand({
    MeetingId: args.meetingId,
    ExternalUserId: args.externalUserId.slice(0, 64),
  }))
  return r.Attendee
}

export async function deleteChimeMeeting(meetingId: string): Promise<void> {
  try {
    await client().send(new DeleteMeetingCommand({ MeetingId: meetingId }))
  } catch {
    // best-effort cleanup
  }
}
