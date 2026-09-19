-- Color del evento de Google Calendar POR CATEGORÍA.
-- Todos los servicios de una categoría (Corporal, Facial, …) usan ese color.
-- Pesa más que el de la profesional: el evento toma el color de la categoría
-- del tratamiento; si esa categoría no tiene color, cae al de la profesional;
-- si tampoco, queda el color por defecto del calendario.
-- Guarda el id de color de Google Calendar ("1".."11"), igual que en staff.
alter table public.service_categories add column if not exists calendar_color_id text;

-- Nota: `services.calendar_color_id` (migración 20260918000000) quedó SIN USO
-- al pasar el color a la categoría. No se borra —las migraciones del proyecto
-- son aditivas— pero ya no se lee ni se escribe desde ninguna pantalla.
