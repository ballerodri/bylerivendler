-- El combo pasa de "cantidad por tratamiento" a PLAN DE SESIONES:
-- Sesión 1 = [Ultra, Vela Slim], Sesión 2 = [Ultra, Vela Up], ...
--
-- Modelo nuevo: UNA fila de combo_services por APARICIÓN (tratamiento × sesión):
--   session_no  = número de sesión del plan (1..K)
--   order_index = orden DENTRO de la sesión (así se hacen ese día)
--   sessions    = queda en 1 en el modelo nuevo (la cantidad total de un
--                 tratamiento se deriva contando sus filas)
-- Filas con session_no NULL = combo del modelo viejo ("cantidad por
-- tratamiento"), que sigue funcionando hasta que la usuaria lo edite.
alter table public.combo_services add column if not exists session_no int;

-- El mismo tratamiento ahora puede aparecer en VARIAS sesiones: se suelta el
-- unique viejo (combo_id, service_id). No borra ningún dato.
alter table public.combo_services drop constraint if exists combo_services_combo_id_service_id_key;

-- El plan congelado en la compra (espejo de combo_services.session_no).
-- Compras viejas (todo NULL) siguen con el agendador por tratamiento.
alter table public.combo_purchase_services add column if not exists session_no int;

-- Qué sesión del plan es este turno (1..K). El estado del plan (agendada /
-- pendiente) se lee de acá y no se confunde al cancelar/reagendar.
alter table public.appointments add column if not exists combo_session_no int;
