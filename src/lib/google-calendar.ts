import { google } from "googleapis"

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? "primary"
const AR_TZ = "America/Argentina/Buenos_Aires"

function oauthClient() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return client
}

function isConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  )
}

export type CalendarEventInput = {
  appointmentId: string
  clientName: string
  serviceNames: string[]
  staffName: string | null
  staffEmail: string | null  // invitada al evento → aparece en su propio Google Calendar
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
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup" as const, minutes: 60 }],
    },
  }
}

export async function createCalendarEvent(
  input: CalendarEventInput
): Promise<string | null> {
  if (!isConfigured()) return null

  try {
    const auth = oauthClient()
    const calendar = google.calendar({ version: "v3", auth })
    const { data } = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: "all",  // envía invitación por email a la profesional
      requestBody: buildRequestBody(input),
    })
    return data.id ?? null
  } catch {
    return null
  }
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  if (!isConfigured()) return

  try {
    const auth = oauthClient()
    const calendar = google.calendar({ version: "v3", auth })
    await calendar.events.delete({
      calendarId: CALENDAR_ID,
      eventId,
      sendUpdates: "all",  // notifica a la profesional que el turno fue cancelado
    })
  } catch {
    // Non-fatal
  }
}

export async function updateCalendarEvent(
  eventId: string,
  input: CalendarEventInput
): Promise<void> {
  if (!isConfigured()) return

  try {
    const auth = oauthClient()
    const calendar = google.calendar({ version: "v3", auth })
    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId,
      sendUpdates: "all",  // notifica a la profesional el nuevo horario
      requestBody: buildRequestBody(input),
    })
  } catch {
    // Non-fatal
  }
}
