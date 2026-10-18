// runs before the page paints, so the saved theme shows with no flash
try {
  var t = JSON.parse(localStorage.getItem("skycast:theme"));
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
