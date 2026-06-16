/* =========================================================
   Theme toggle (Dark / Light mode)
   ========================================================= */
(function () {
    const root = document.documentElement;
    const toggleButtons = document.querySelectorAll("#themeToggle");

    // Load saved theme (defaults to light)
    const savedTheme = localStorage.getItem("chat-theme") || "light";
    root.setAttribute("data-theme", savedTheme);
    updateIcon(savedTheme);

    toggleButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const current = root.getAttribute("data-theme");
            const next = current === "dark" ? "light" : "dark";
            root.setAttribute("data-theme", next);
            localStorage.setItem("chat-theme", next);
            updateIcon(next);
        });
    });

    function updateIcon(theme) {
        toggleButtons.forEach((btn) => {
            btn.textContent = theme === "dark" ? "☀️" : "🌙";
        });
    }
})();
