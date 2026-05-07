import { google } from "googleapis"
import { createClient } from "@supabase/supabase-js"
import { getOAuth2Client } from "./google-oauth"

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? "primary"
const AR_TZ = "America/Argentina/Buenos_Aires"

async function getRefreshToken(): Promise<string | null> {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data } = await admin
    .from("google_calendar_config")
    .select("refresh_token")
    .eq("id", 1)
    .maybeSingle()
  return data?.refresh_token ?? null
}

export type CalendarEventInput = {
  appointmentId: string
  clientName: string
  serviceNames: string[]
  staffName: string | null
  staffEmail: string | null
  staffColorId?: string | null
  startsAt: Date
  endsAt: Date
  notes?: string | null
}

function buildRequestBody(input: CalendarEventInput) {
  const summary = `${input.clientName} — ${input.serviceNames.join(" + ")}`
  const description = [
    input.staffName ? `Profesional: ${input.staffName}` : null,
    input.notes ? `Notas: ${input.notes}` : null,
    `Turno ID: ${input.appointmentId}`,
  ]
    .filter(Boolean)
    .join("\n")

  const attendees = input.staffEmail
    ? [{ email: input.staffEmail, displayName: input.staffName ?? undefined }]
    : undefined

  return {
    summary,
    description,
    start: { dateTime: input.startsAt.toISOString(), timeZone: AR_TZ },
    end: { dateTime: input.endsAt.toISOString(), timeZone: AR_TZ },
    attendees,
    ...(input.staffColorId ? { colorId: input.staffColorId } : {}),
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup" as const, minutes: 60 }],
    },
  }
}

export async function createCalendarEvent(
  input: CalendarEventInput
): Promise<string | null> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) return null

  try {
    const auth = getOAuth2Client()
    auth.setCredentials({ refresh_token: refreshToken })
    const calendar = google.calendar({ version: "v3", auth })
    const { data } = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: "all",
      requestBody: buildRequestBody(input),
    })
    return data.id ?? null
  } catch {
    return null
  }
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) return

  try {
    const auth = getOAuth2Client()
    auth.setCredentials({ refresh_token: refreshToken })
    const calendar = google.calendar({ version: "v3", auth })
    await calendar.events.delete({
      calendarId: CALENDAR_ID,
      eventId,
      sendUpdates: "all",
    })
  } catch {
    // Non-fatal
  }
}

export async function updateCalendarEvent(
  eventId: string,
  input: CalendarEventInput
): Promise<void> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) return

  try {
    const auth = getOAuth2Client()
    auth.setCredentials({ refresh_token: refreshToken })
    const calendar = google.calendar({ version: "v3", auth })
    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId,
      sendUpdates: "all",
      requestBody: buildRequestBody(input),
    })
  } catch {
    // Non-fatal
  }
}
