-- El consentimiento en PAPEL (ficha técnica + consentimiento informado, 3
-- hojas) se sube como fotos a la ficha de la clienta. Se reutiliza la tabla y
-- el bucket que ya usan las fotos antes/después: alcanza con un tipo nuevo
-- ('consent') y una nota opcional por hoja.
--
-- Aditiva y segura: la nota es nullable y el tipo nuevo no toca ninguna fila
-- existente (las de antes/después siguen validando igual).

-- 1) Ampliar la restricción de `type` para que acepte 'consent'.
--
--    El nombre de esa restricción lo generó Postgres solo (la migración
--    original la declaró inline, sin nombrarla). Por eso se BUSCA en el
--    catálogo en vez de asumir cómo se llama: si se asumiera mal, el DROP no
--    haría nada, la restricción vieja seguiría rechazando 'consent' y las
--    subidas del consentimiento fallarían recién en producción.
--    Se buscan las restricciones CHECK cuya ÚNICA columna sea `type` (por
--    catálogo, no por texto: buscar '%type%' en la definición también agarraría
--    cualquier futura restricción que apenas mencione un `content_type` o un
--    cast, y la borraría sin querer).
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attname = 'type'
     and not att.attisdropped
    where con.conrelid = 'public.client_photos'::regclass
      and con.contype = 'c'
      and con.conkey = array[att.attnum]::smallint[]
  loop
    execute format('alter table public.client_photos drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.client_photos
  add constraint client_photos_type_check
  check (type in ('before', 'after', 'consent'));

-- 2) Nota opcional de la hoja (ej. "firmado el 12/07").
alter table public.client_photos
  add column if not exists note text;
