export function showToast(msg, ms = 1800) {
  const host = document.getElementById("toast");
  if (!host) return alert(msg);
  const div = document.createElement("div");
  div.className = "toast-bubble";
  div.textContent = msg;
  host.appendChild(div);
  requestAnimationFrame(() => div.classList.add("show"));
  setTimeout(() => {
    div.classList.remove("show");
    setTimeout(() => div.remove(), 250);
  }, ms);
}
