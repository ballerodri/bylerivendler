import { google } from "googleapis"

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  )
}

export function buildAuthUrl(state: string): string {
  const client = getOAuth2Client()
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // fuerza que Google devuelva refresh_token
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    state,
  })
}

export async function exchangeCode(code: string) {
  const client = getOAuth2Client()
  const { tokens } = await client.getToken(code)
  return tokens
}
