/* global document */

const gallery = document.querySelector("[data-gallery]");
const galleryImage = gallery?.querySelector("[data-gallery-image]");

gallery?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-image]");
  if (!button || !galleryImage) return;

  for (const tab of gallery.querySelectorAll('button[role="tab"]')) {
    const selected = tab === button;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }

  galleryImage.animate(
    [
      { opacity: 0.35, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 260, easing: "ease-out" },
  );
  galleryImage.src = `./assets/screens/${button.dataset.image}`;
  galleryImage.alt = button.dataset.alt ?? "Vocabulary Trainer product screen";
});

for (const link of document.querySelectorAll('[aria-disabled="true"]')) {
  link.addEventListener("click", (event) => event.preventDefault());
}
