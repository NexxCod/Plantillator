// Lista de plantillas (render + acciones)
export function renderTemplateList({
  tplList,
  templates,
  onUse,
  onRename,
  onDelete,
  emptyText = "No hay plantillas guardadas aún."
}) {
  if (!tplList) return;

  // Limpia la lista
  tplList.innerHTML = "";

  // Ordena alfabéticamente (insensible a acentos/mayúsculas)
  const names = Object.keys(templates || {}).sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );

  // Vacío
  if (names.length === 0) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = emptyText;
    tplList.appendChild(empty);
    return;
  }

  // Render de filas
  names.forEach((name) => {
    const row = document.createElement("div");
    row.className = "tpl-row";

    // Nombre (con elipsis y tooltip para ver completo al hover)
    const lab = document.createElement("div");
    lab.className = "name";
    lab.textContent = name;
    lab.title = name;

    // Contenedor de acciones (compacto)
    const actions = document.createElement("div");
    actions.className = "tpl-actions";

    // Botón: Usar
    const useBtn = document.createElement("button");
    useBtn.textContent = "Usar";
    useBtn.title = "Aplicar plantilla";
    useBtn.addEventListener("click", () => {
      if (onUse) onUse(name);
    });

    // Botón: Renombrar
    const renBtn = document.createElement("button");
    renBtn.textContent = "Renombrar";
    renBtn.title = "Renombrar plantilla";
    renBtn.addEventListener("click", () => {
      if (onRename) onRename(name);
    });

    // Botón: Eliminar
    const delBtn = document.createElement("button");
    delBtn.textContent = "Eliminar";
    delBtn.title = "Eliminar plantilla";
    delBtn.addEventListener("click", () => {
      if (onDelete) onDelete(name);
    });

    // Montaje
    actions.appendChild(useBtn);
    actions.appendChild(renBtn);
    actions.appendChild(delBtn);

    row.appendChild(lab);      // columna flexible (nombre)
    row.appendChild(actions);  // columna auto (acciones)

    tplList.appendChild(row);
  });
}
