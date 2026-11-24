NATIONAL TOURNAMENTS — PLATAFORMA WEB
=====================================

ARCHIVOS
--------
index.html             Página principal.
styles.css             Diseño adaptable a PC, tablet y celular.
app.js                 Inscripciones, panel staff, CRUD y sincronización.
extended.js            Registro de equipos, rosters, actividades y ranking.
config.js              URL y clave pública de Supabase.
supabase-schema.sql    Tablas, roles, políticas RLS, cupos y funciones seguras.

IMPORTANTE
----------
GitHub Pages solo aloja los archivos estáticos. Supabase se usa como backend
para autenticación, base de datos y actualizaciones en tiempo real.
No uses una contraseña escrita en HTML/JavaScript.
Nunca pegues la clave "service_role" en config.js. Solo se usa la clave anon/public.

PASO 1 — CREAR SUPABASE
-----------------------
1. Entra a https://supabase.com/ y crea un proyecto llamado NATIONAL TOURNAMENTS.
2. Guarda la contraseña de la base de datos en un gestor seguro.
3. En el proyecto abre SQL Editor > New query.
4. Copia TODO el contenido de supabase-schema.sql y pulsa RUN.
5. En Project Settings > API (o Data API), copia:
   - Project URL
   - anon/public key (NO service_role)

PASO 2 — CONFIGURAR LA PÁGINA
-----------------------------
1. Abre config.js.
2. Reemplaza PEGA_AQUI_TU_SUPABASE_PROJECT_URL por la Project URL.
3. Reemplaza PEGA_AQUI_TU_SUPABASE_ANON_PUBLIC_KEY por la anon/public key.
4. Guarda los cambios.

PASO 3 — CREAR LA CUENTA ADMINISTRADORA
---------------------------------------
1. En Supabase > Authentication > Users, crea/invita tu cuenta administradora
   con el correo que usarás para gestionar NATIONAL TOURNAMENTS.
2. La primera cuenta creada aparecerá en public.profiles con rol "staff".
3. En Supabase > SQL Editor ejecuta este comando reemplazando el correo:

   update public.profiles p
   set role = 'admin'
   from auth.users u
   where p.id = u.id
     and lower(u.email) = lower('TU_CORREO_ADMIN');

4. Inicia sesión desde la web con ese correo y su contraseña.

PASO 4 — AÑADIR STAFF
---------------------
1. En Authentication > Users, pulsa Invite user y escribe el correo del miembro.
2. Cuando el miembro acepte la invitación e inicie sesión una vez, su perfil
   aparecerá en el panel > GESTIÓN STAFF.
3. El administrador puede asignarle rol STAFF o ADMINISTRADOR desde ese panel.
4. Solo da rol ADMINISTRADOR a personas de máxima confianza.

PASO 5 — PUBLICAR EN GITHUB PAGES
---------------------------------
1. Sube index.html, styles.css, app.js, extended.js y config.js a la raíz del repositorio.
2. En GitHub abre Settings > Pages.
3. En Build and deployment selecciona Deploy from a branch.
4. Selecciona la rama main y la carpeta /(root). Guarda.
5. Espera el despliegue y abre la URL que GitHub Pages muestra.

FUNCIONES INCLUIDAS
-------------------
- Sitio corporativo adaptable a móvil, tablet y escritorio.
- Competiciones tipo scrim, torneo y liga.
- Inscripción pública vinculada a una competición específica.
- Datos del manager, número de contacto, Discord y roster de 4 titulares
  más un suplente opcional.
- Código privado para consultar el estado de la solicitud.
- Panel privado con roles admin/staff.
- Crear, editar y eliminar competencias.
- Abrir/cerrar inscripciones y configurar cupos.
- Aprobar/rechazar equipos.
- Guardar ID y contraseña de sala en una tabla privada.
- El manager aprobado puede consultar los datos de sala con su código.
- Publicar resultados y noticias.
- Actualizaciones en tiempo real.
- RLS para que el público no pueda consultar teléfonos, Discord ni rosters
  de las solicitudes.

NOTAS DE SEGURIDAD
------------------
- La clave anon/public está diseñada para estar en el frontend; las políticas
  RLS son las que protegen los datos.
- NUNCA publiques la service_role key.
- Usa contraseñas únicas y activa MFA para cuentas administradoras si está disponible.
- Limita el acceso a las cuentas de staff.
- Configura el dominio de GitHub Pages en Supabase Authentication > URL Configuration
  (Site URL y Redirect URLs) antes de probar inicio de sesión.
- Revisa las políticas RLS antes de abrir inscripciones reales.

LIMITACIÓN DE ESTA ENTREGA
--------------------------
Esta es la base funcional de la plataforma, pero queda pendiente conectar el
proyecto real de Supabase (URL/anon key) y crear/promover la primera cuenta admin.
Sin esos dos pasos no pueden funcionar las inscripciones compartidas, el login
ni la sincronización. No hay credenciales ni contraseñas incrustadas en el código.


NUEVO EN LA VERSIÓN 2
---------------------
- Registro de organizaciones sin un límite fijo de cantidad de equipos.
- Ficha de equipo con logo PNG/JPG, nombre, TAG, manager y país.
- Roster de 6 titulares y un séptimo jugador opcional.
- Cada jugador registra edad, país, nick, ID de Free Fire, captura de cuenta
  y fotografía personal.
- Las fotos personales y capturas se guardan en dos buckets separados: uno público para logos/portadas y otro privado para fotos personales/comprobantes; solo staff
  puede leer esos archivos. El directorio público muestra logo y datos básicos.
- Actividades de tipo RELÁMPAGO, TORNEO y ENTRENO con fecha, inscripción,
  pozo de premios, instrucciones de pago en texto libre, link/grupo, número
  de salas, imagen y descripción.
- Solicitudes de actividad vinculadas a equipos aprobados y validación de pago
  desde el panel.
- Ranking acumulado con puntos de posición + kills + Booyah.
- Roles ampliados: ADMIN, STAFF, CREADOR, VIP y EQUIPO. La matriz fina de
  permisos debe asignarse según funciones antes de dar acceso a cuentas reales.

IMPORTANTE SOBRE FOTOS Y PAGOS
------------------------------
No publiques fotos personales ni capturas de cuentas de menores en el directorio
público. Esta versión las mantiene privadas para revisión del staff. El formulario
de actividad permite guardar una URL de comprobante en la solicitud; para pagos
reales se recomienda integrar un proveedor de pago seguro. No almacenes datos
de tarjetas ni contraseñas en formularios.
