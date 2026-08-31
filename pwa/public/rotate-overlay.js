(function () {
	const overlay = document.createElement("div");
	overlay.id = "rotate-overlay";
	overlay.innerHTML = '<div class="icon">↻</div><div>Rotate your device to play</div>';
	document.body.appendChild(overlay);

	const portraitQuery = window.matchMedia("(orientation: portrait)");

	function update(isPortrait) {
		overlay.classList.toggle("visible", isPortrait);
	}

	update(portraitQuery.matches);
	portraitQuery.addEventListener("change", (event) => update(event.matches));
})();
