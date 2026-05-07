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
  startsAt: Date
  endsAt: Date
  notes?: string | null
}

export async function createCalendarEvent(
  input: CalendarEventInput
): Promise<string | null> {
  if (!isConfigured()) return null

  try {
    const auth = oauthClient()
    const calendar = google.calendar({ version: "v3", auth })

    const summary = `${input.clientName} — ${input.serviceNames.join(" + ")}`
    const description = [
      input.staffName ? `Profesional: ${input.staffName}` : null,
      input.notes ? `Notas: ${input.notes}` : null,
      `Turno ID: ${input.appointmentId}`,
    ]
      .filter(Boolean)
      .join("\n")

    const { data } = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary,
        description,
        start: { dateTime: input.startsAt.toISOString(), timeZone: AR_TZ },
        end: { dateTime: input.endsAt.toISOString(), timeZone: AR_TZ },
        reminders: {
          useDefault: false,
          overrides: [{ method: "popup", minutes: 60 }],
        },
      },
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
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId })
  } catch {
    // Non-fatal: el turno ya está cancelado en la app
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

    const summary = `${input.clientName} — ${input.serviceNames.join(" + ")}`
    const description = [
      input.staffName ? `Profesional: ${input.staffName}` : null,
      input.notes ? `Notas: ${input.notes}` : null,
      `Turno ID: ${input.appointmentId}`,
    ]
      .filter(Boolean)
      .join("\n")

    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId,
      requestBody: {
        summary,
        description,
        start: { dateTime: input.startsAt.toISOString(), timeZone: AR_TZ },
        end: { dateTime: input.endsAt.toISOString(), timeZone: AR_TZ },
      },
    })
  } catch {
    // Non-fatal
  }
}
