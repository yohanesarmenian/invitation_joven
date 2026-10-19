// Original, isolated design review. No API calls, storage, credentials, or real QR.
const select = (selector) => document.querySelector(selector);
const stages = [
  select("#closed-stage"),
  select("#opened-stage"),
  select("#content-stage"),
];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let opening = false;
let openingTimer;
let galleryIndex = 0;
let returnFocus;

function showStage(index, focus = true) {
  clearTimeout(openingTimer);
  opening = false;
  select("#open-envelope").disabled = false;
  select("#closed-stage").classList.remove("is-opening");
  for (const [i, stage] of stages.entries()) {
    stage.hidden = i !== index;
    stage.classList.remove("entering");
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  select(".greeting").classList.remove("entering");
  if (!reduceMotion.matches && focus) {
    // Never transform the grid containing the desktop sticky panel.
    (index === 2 ? select(".greeting") : stages[index]).classList.add(
      "entering",
    );
  }
  if (focus)
    [
      select("#open-envelope"),
      select("#view-invitation"),
      select("#invitation-content"),
    ][index].focus({ preventScroll: true });
}

select("#open-envelope").addEventListener("click", () => {
  if (opening) return;
  opening = true;
  select("#open-envelope").disabled = true;
  select("#closed-stage").classList.add("is-opening");
  if (reduceMotion.matches) showStage(1);
  else openingTimer = setTimeout(() => showStage(1), 650);
});
select("#view-invitation").addEventListener("click", () => showStage(2));
select("#restart").addEventListener("click", () => showStage(0));
reduceMotion.addEventListener("change", () => {
  if (opening && reduceMotion.matches) showStage(1);
});

const feedback = select("#feedback-dialog");
const states = {
  accepted: [
    "Thank You for Confirming!",
    "We have received your RSVP and cannot wait to celebrate our special day with you.",
    true,
  ],
  declined: [
    "Thank you for letting us know",
    "Your response has been saved as not attending. You can update your response before the reply deadline.",
    false,
  ],
  conflict: [
    "Your response has changed",
    "Review the latest RSVP before making further changes. Your current edits should remain available while you review.",
    false,
  ],
  uncertain: [
    "We could not confirm the result",
    "Your response may have been saved. Check the latest RSVP before submitting again; the application must not resend automatically.",
    false,
  ],
  deadline: [
    "The reply deadline has passed",
    "You can still read your invitation. Public RSVP changes are now closed.",
    false,
  ],
  message: [
    "Message Sent!",
    "Thank you for your message. The bride and groom look forward to reading all your warm wishes after the celebration.",
    false,
  ],
};
function showFeedback(title, copy, pass = false) {
  returnFocus = document.activeElement;
  select("#feedback-title").textContent = title;
  select("#feedback-copy").textContent = copy;
  select("#pass-preview").hidden = !pass;
  feedback.showModal();
  feedback.querySelector(".dialog-close").focus();
}
function showState(state) {
  showFeedback(...states[state]);
}
feedback
  .querySelector(".dialog-close")
  .addEventListener("click", () => feedback.close());
select("#feedback-back").addEventListener("click", () => feedback.close());
feedback.addEventListener("close", () =>
  returnFocus?.focus({ preventScroll: true }),
);
document
  .querySelectorAll("[data-state]")
  .forEach((button) =>
    button.addEventListener("click", () => showState(button.dataset.state)),
  );
document
  .querySelectorAll("[data-material]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      showFeedback(
        "Parking guide",
        `Materi parkir ${button.dataset.material} belum final. Ini hanya preview tampilan; halaman undangan asli menyembunyikan aksi bila materi belum published.`,
      ),
    ),
  );
document
  .querySelectorAll("[data-calendar]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      showFeedback(
        "Add to calendar",
        `Preview tombol kalender untuk ${button.dataset.calendar}. Aplikasi asli memakai tanggal dan event yang diizinkan backend. Prototype tidak mengunduh jadwal.`,
      ),
    ),
  );

select("#rsvp-form").addEventListener("change", () => {
  const declined =
    select('input[name="attendance"]:checked')?.value === "declined";
  select("#attendance-details").hidden = declined;
  select("#rsvp-error").hidden = true;
});
select("#rsvp-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const selected = select('input[name="attendance"]:checked');
  const error = select("#rsvp-error");
  let message = "";
  if (!selected) message = "Choose whether you will be joining us.";
  else if (
    selected.value === "accepted" &&
    !select('input[name="invitee"]:checked')
  )
    message = "Select at least one named guest for this example.";
  else if (
    selected.value === "accepted" &&
    !select('input[name="event"]:checked')
  )
    message = "Select an event for this example.";
  if (message) {
    error.querySelector("p").textContent = message;
    error.hidden = false;
    error.focus();
    return;
  }
  error.hidden = true;
  showState(selected.value);
});
select("#message-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const empty = !select("#message").value.trim();
  select("#message-error").hidden = !empty;
  if (empty) select("#message-error").focus();
  else showState("message");
});

const photoDialog = select("#photo-dialog");
const photos = [...document.querySelectorAll("[data-photo] img")];
function updatePhoto() {
  select("#photo-view").src = photos[galleryIndex].src;
  select("#photo-view").alt = photos[galleryIndex].alt;
  select("#photo-position").textContent =
    `${galleryIndex + 1} / ${photos.length}`;
}
document.querySelectorAll("[data-photo]").forEach((button) =>
  button.addEventListener("click", () => {
    returnFocus = button;
    galleryIndex = Number(button.dataset.photo);
    updatePhoto();
    photoDialog.showModal();
    select(".photo-close").focus();
  }),
);
function movePhoto(delta) {
  galleryIndex = (galleryIndex + delta + photos.length) % photos.length;
  updatePhoto();
}
select("#photo-previous").addEventListener("click", () => movePhoto(-1));
select("#photo-next").addEventListener("click", () => movePhoto(1));
select(".photo-close").addEventListener("click", () => photoDialog.close());
photoDialog.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    movePhoto(event.key === "ArrowRight" ? 1 : -1);
  }
});
photoDialog.addEventListener("close", () =>
  returnFocus?.focus({ preventScroll: true }),
);

// Content is visible by default. Observer failure cannot hide a section.
if (typeof window.IntersectionObserver === "function") {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          if (!reduceMotion.matches)
            entry.target.classList.add("reveal-visible");
          observer.unobserve(entry.target);
        }
    },
    { threshold: 0.12 },
  );
  document
    .querySelectorAll("[data-reveal]")
    .forEach((section) => observer.observe(section));
}
const initial = new URLSearchParams(location.search).get("view");
showStage(initial === "content" ? 2 : initial === "opened" ? 1 : 0, false);
window.addEventListener("pagehide", () => clearTimeout(openingTimer));
