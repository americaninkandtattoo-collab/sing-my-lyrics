function bindHomePage() {
  const home = document.getElementById("homePage");
  if (!home) return;

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", e => {
      const target = link.getAttribute("href").replace("#", "");

      document.querySelectorAll(".main-wrap").forEach(p => {
        p.style.display = "none";
      });

      const page = document.getElementById(target + "Page");
      if (page) page.style.display = "block";

      document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
      link.classList.add("active");

      e.preventDefault();
    });
  });

  home.style.display = "block";
}
