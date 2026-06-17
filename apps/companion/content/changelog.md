# v3.1 — 12 de Junio de 2026

## Pantalla de mazo — rediseño completo
- Nueva grilla de cartas con imágenes recortadas (HalfCardCell), 1 a 3 columnas configurables
- Pellizco para cambiar columnas directamente en la grilla
- Drag-to-action: mantené presionada una carta y arrastrala para recortarla, cambiar copias (1/2/3), marcar favorita o eliminarla
- Barra colapsable con contadores Dynasty/Fate y toggle de recortadas
- Período de gracia de 2.5 segundos al recortar o eliminar (podés rescatar la carta tocando +)
- Ordenamiento por costo, nombre o fuerza con dirección asc/desc
- 3 niveles de colapso de grupos en la barra inferior
 
## Buscador — cartas y carousel
- La tira de imágenes ahora sigue el carousel suavemente al deslizar (antes saltaba de carta en carta)
- Corregido freeze ocasional del carousel al volver a la app después de aplicar filtros
- Al aplicar filtros ya no se ve un flash de los resultados anteriores antes de mostrar los nuevos
- Al aplicar filtros el carousel y la grilla vuelven a la carta 1 sin flash de posición
- Las cartas de edición Samurai ahora tienen sus action keywords indexadas (para el filtro por designador)
 
## Correcciones de v2.2
- Se reforzó toda la importación de datos para evitar errores potenciales
- Se mejoraron los mensajes de error tras una importación fallida o con problemas
- Se agregaron protecciones para los casos en que algunas cartas quedasen huérfanas de la DB tras eliminación de cartas en esta última
- Eliminado el botón de "resync" de tira+carousel (era innecesario tras el refactor)
- Eliminado el flash de carta al cambiar de tab en el carousel