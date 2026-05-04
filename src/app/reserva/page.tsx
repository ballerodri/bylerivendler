import { fetchCatalog } from "./queries"
import ReservaFlow from "./flow"
import "./reserva.css"

export const dynamic = "force-dynamic"

export default async function ReservaPage() {
  const categories = await fetchCatalog()
  return <ReservaFlow categories={categories} />
}
