import {
  auth, db,requireAuth, getUserProfile, installLogoutHandlers,
  applyProfileToPage, flash, routeForRole
} from "./firebase-core.js";import {
  collection, addDoc, getDocs, getDoc, setDoc,
  updateDoc, deleteDoc, doc,
  query, where, orderBy, limit,
  serverTimestamp, onSnapshot, writeBatch,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

import {
    CLOUDINARY_CONFIG
} from "./cloudinary-config.js";
import { cancelExpiredPendingBookings } from "./booking-expiry.js";
import {
  EmailAuthProvider, reauthenticateWithCredential, updatePassword, deleteUser
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";


const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
const ADMIN_PAGES = new Set(["admin-index.html","admin-approval.html","admin-provider.html","admin-logs.html","admin-reminders.html","admin-support.html","admin-settings.html","admin-edit.html","view-permit.html"]);
const PROVIDER_PAGES = new Set(["rm-index.html","rm-booking.html","rm-profile.html","rm-search.html","rm-settings.html"]);
const PUBLIC_PAGES = new Set(["login.html","signup.html","reset-password.html","firebase-connection.html","faq.html","safety.html"]);

function text(el, value) { if (el && value !== undefined && value !== null) el.textContent = value; }
function escapeHtml(v = "") { return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function dateText(value) {
  try {
    if (!value) return "";
    const d = value.toDate ? value.toDate() : new Date(value);
    return d.toLocaleString();
  } catch { return ""; }
}
function money(v) { const n = Number(v); return Number.isFinite(n) ? `₱${n.toLocaleString()}` : (v || ""); }
function qparam(name) { return new URLSearchParams(location.search).get(name); }
function selectedProviderId() { return qparam("provider") || sessionStorage.getItem("reparoSelectedProviderId") || ""; }
function getInput(form, index, selector = "input") { return form?.querySelectorAll(selector)?.[index] || null; }

async function logActivity(userId, action, details = "") {
  try { await addDoc(collection(db, "activityLogs"), { userId, action, details, createdAt: serverTimestamp() }); } catch (e) { console.warn("Activity log skipped", e); }
}

async function notify(userId, type, title, message, extra = {}) {
  if (!userId) return;
  try { await addDoc(collection(db, "notifications"), { userId, type, title, message, read: false, createdAt: serverTimestamp(), ...extra }); } catch (e) { console.warn("Notification skipped", e); }
}

async function loadProfile(ctx) {
  applyProfileToPage(ctx.profile, ctx.user);
  installLogoutHandlers();
}

function wireDrawer() {
  const open = document.getElementById("hamburgerBtn");
  const drawer = document.getElementById("sideDrawer");
  const overlay = document.getElementById("drawerOverlay");
  const close = document.getElementById("drawerClose");
  const show = () => { drawer?.classList.add("open"); overlay?.classList.add("active"); };
  const hide = () => { drawer?.classList.remove("open"); overlay?.classList.remove("active"); };
  open?.addEventListener("click", show); close?.addEventListener("click", hide); overlay?.addEventListener("click", hide);
}

async function handleSettings(ctx) {
  const links = [...document.querySelectorAll("a,button")];
  const edit = links.find(x => /edit profile/i.test(x.textContent || ""));
  const change = links.find(x => /change password/i.test(x.textContent || ""));
  const del = links.find(x => /delete account/i.test(x.textContent || ""));
  const profileDialog = document.getElementById("editProfileDialog");
  const profileForm = document.getElementById("editProfileForm");
  const profileError = document.getElementById("editProfileError");
  const saveProfile = document.getElementById("saveEditProfile");

  const closeProfileDialog = () => profileDialog?.close();

  document.getElementById("closeEditProfile")
    ?.addEventListener("click", closeProfileDialog);
  document.getElementById("cancelEditProfile")
    ?.addEventListener("click", closeProfileDialog);

  edit?.addEventListener("click", async event => {
    event.preventDefault();

    try {
      const snapshot = await getDoc(doc(db, "users", ctx.user.uid));
      const profile = snapshot.data() || ctx.profile || {};

      profileForm.elements.fullName.value =
        profile.displayName || profile.fullName ||
        ctx.user.displayName || "";

      document.getElementById("editEmail").value =
        ctx.user.email || profile.email || "";

      profileForm.elements.phone.value =
        profile.contactNumber || profile.phone || "";

      profileForm.elements.location.value =
        profile.location || "";

      profileError.textContent = "";
      profileDialog.showModal();
    } catch (error) {
      flash(error.message || "Could not load your profile.", "error");
    }
  });

  profileForm?.addEventListener("submit", async event => {
    event.preventDefault();

    const displayName = profileForm.elements.fullName.value.trim();
    const contactNumber = profileForm.elements.phone.value.trim();
    const locationText = profileForm.elements.location.value.trim();

    if (!displayName) {
      profileError.textContent = "Enter your full name.";
      return;
    }

    saveProfile.disabled = true;
    saveProfile.textContent = "Saving…";
    profileError.textContent = "";

    try {
      await updateDoc(doc(db, "users", ctx.user.uid), {
        displayName,
        contactNumber,
        location: locationText,
        updatedAt: serverTimestamp()
      });

      ctx.profile = {
        ...ctx.profile,
        displayName,
        contactNumber,
        location: locationText
      };

      closeProfileDialog();
      flash("Profile updated.");
      location.href = "myprofile.html";
    } catch (error) {
      profileError.textContent =
        error.code === "permission-denied"
          ? "Firestore rules do not allow this profile update."
          : error.message || "Could not save your profile.";
    } finally {
      saveProfile.disabled = false;
      saveProfile.textContent = "Save Changes";
    }
  });
  change?.addEventListener("click", event => {
    event.preventDefault();
    const emailProvider = ctx.user.providerData.some(p => p.providerId === "password");
    if (!emailProvider) return flash("This account signs in with Google. Manage its password through Google.", "error");
    const current = prompt("Enter your current password:");
    if (!current) return;
    const next = prompt("Enter your new password (minimum 8 characters):");
    if (!next || next.length < 8) return flash("New password must be at least 8 characters.", "error");
    reauthenticateWithCredential(ctx.user, EmailAuthProvider.credential(ctx.user.email, current))
      .then(() => updatePassword(ctx.user, next))
      .then(() => flash("Password updated successfully."))
      .catch(e => flash(e.code === "auth/invalid-credential" ? "Current password is incorrect." : e.message, "error"));
  });
  del?.addEventListener("click", async event => {
    event.preventDefault();
    if (!confirm("Delete your REPARO account? This cannot be undone.")) return;
    try {
      await deleteDoc(doc(db, "users", ctx.user.uid));
      await deleteUser(ctx.user);
      location.href = "signup.html";
    } catch (e) { flash(e.code === "auth/requires-recent-login" ? "Please log out and log in again before deleting your account." : e.message, "error"); }
  });
}async function handleProfile(ctx) {
  const profile = ctx.profile || {};

  const name =
    profile.displayName ||
    profile.fullName ||
    ctx.user.displayName ||
    "REPARO User";

  const email =
    profile.email ||
    ctx.user.email ||
    "";

  document
    .querySelectorAll(
      ".profile-fullname, .drawer-user-info h3"
    )
    .forEach(element => {
      element.textContent = name;
    });

  document
    .querySelectorAll(".profile-email")
    .forEach(element => {
      element.textContent = email;
    });

  document.querySelectorAll(".profile-phone").forEach(element => {
    element.textContent =
      profile.contactNumber || profile.phone || "Not provided";
  });

  void displayServiceLocation(
    profile,
    document.querySelectorAll(
      ".profile-location span:last-child, .profile-location-text"
    )
  );

  if (page !== "myprofile.html") return;

  // Update matching numbers in both the profile card and side drawer.
  function showProfileNumber(labels, value) {
    document.querySelectorAll("span").forEach(label => {
      if (!labels.includes(label.textContent.trim())) return;

      const number = label.parentElement?.querySelector(":scope > strong");
      if (number) number.textContent = String(value);
    });
  }

  const stopBookings = onSnapshot(
    query(
      collection(db, "bookings"),
      where("customerId", "==", ctx.user.uid)
    ),
    snapshot => showProfileNumber(["Bookings"], snapshot.size),
    error => console.error("Profile bookings:", error)
  );

  // These are the provider ratings submitted by this customer.
  const stopShares = onSnapshot(
    collection(db, "users", ctx.user.uid, "shares"),
    snapshot => showProfileNumber(["Shares"], snapshot.size),
    error => console.error("Profile shares:", error)
  );

  const stopSaved = onSnapshot(
    collection(db, "users", ctx.user.uid, "savedProviders"),
    snapshot => showProfileNumber(["Saved"], snapshot.size),
    error => console.error("Saved providers:", error)
  );

  window.addEventListener("pagehide", () => {
    stopBookings();
      stopShares();
    stopSaved();
  }, { once: true });
}
function setupPostLocation() {
  const button = document.getElementById("detectPostLocation");
  const input = document.getElementById("location");
  const title = document.getElementById("postLocationTitle");
  const status = document.getElementById("postLocationStatus");

  if (!button || !input) {
    console.error("Post location button or input is missing.");
    return;
  }

  // Prevent duplicate click listeners.
  if (button.dataset.locationReady === "true") return;
  button.dataset.locationReady = "true";
  button.type = "button";

  let busy = false;

  function showStatus(message, error = false) {
    if (!status) return;
    status.textContent = message;
    status.style.color = error ? "#b42318" : "#087f70";
  }

  button.addEventListener("click", async event => {
    event.preventDefault();

    if (busy) return;

    if (!window.isSecureContext) {
      showStatus(
        "Location requires HTTPS. Open the hosted REPARO website.",
        true
      );
      return;
    }

    if (!navigator.geolocation) {
      showStatus(
        "This browser does not support location detection.",
        true
      );
      return;
    }

    busy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");

    if (title) title.textContent = "Detecting your location…";
    showStatus("Allow location access when your browser asks.");

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 0
          }
        );
      });

      const {
        latitude,
        longitude,
        accuracy
      } = position.coords;

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      ) {
        throw new Error("The device returned an invalid location.");
      }

      // These fields match your existing Firestore submit code.
      input.value =
        `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

      input.dataset.latitude = String(latitude);
      input.dataset.longitude = String(longitude);

      if (Number.isFinite(accuracy)) {
        input.dataset.accuracy = String(accuracy);
      } else {
        delete input.dataset.accuracy;
      }

      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

     if (title) {
  title.textContent = "Finding your location name…";
}

showStatus("Coordinates detected. Looking up the address…");

// Show the readable location using your existing address lookup.
if (title) {
  await displayServiceLocation(
    {
      latitude,
      longitude
    },
    [title]
  );

  const addressName = title.textContent.trim();

  const lookupFailed = [
    "",
    "Finding location name…",
    "Finding your location name…",
    "Location name unavailable",
    "Location not provided"
  ].includes(addressName);

  if (!lookupFailed) {
    // Save the readable address in serviceRequests.location.
    // Latitude, longitude and accuracy remain in input.dataset.
    input.value = addressName;

    input.dispatchEvent(
      new Event("input", { bubbles: true })
    );

    input.dispatchEvent(
      new Event("change", { bubbles: true })
    );

    showStatus(
      Number.isFinite(accuracy)
        ? `Estimated accuracy: ${Math.round(accuracy)} metres. Check that this is your area. Tap again to detect another location.`
        : "Check that this is your area. Tap again to detect another location."
    );
  } else {
    title.textContent = "Coordinates detected — address unavailable";

    showStatus(
      "Your coordinates were captured, but the place name could not be loaded. Tap again to retry.",
      true
    );
  }
}

// Update the instruction below the location name.
const hint = button.querySelector(".post-location-hint");

if (hint) {
  hint.textContent = "Customer’s current detected location";
}

// Keep one small attribution for the address data.
if (!document.getElementById("locationSourceCredit")) {
  const credit = document.createElement("p");
  credit.id = "locationSourceCredit";

  const link = document.createElement("a");
  link.href = "https://www.openstreetmap.org/copyright";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Location data © OpenStreetMap";

  credit.append(link);
  status?.insertAdjacentElement("afterend", credit);
}
    } catch (error) {
      console.error("Post location:", error);

      const messages = {
        1: "Location permission was denied. Allow location for this site in your browser settings, then try again.",
        2: "Your device could not determine its location. Turn on Location Services and try again.",
        3: "Location detection timed out. Check your connection and try again."
      };

      showStatus(
        messages[error.code] ||
        error.message ||
        "Unable to detect your location.",
        true
      );

      if (title) {
        title.textContent = input.value
          ? "Previous location kept — tap to retry"
          : "Tap to Detect My Location";
      }
    } finally {
      busy = false;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });
}
async function handlePostRequest(ctx) {

    const form =
        document.getElementById("requestForm");


    if (!form) {
        return;
    }
setupPostLocation();

    const descriptionInput =
        document.getElementById("description");


    const charCount =
        form.querySelector(".char-count");


    const postStatus =
        document.getElementById("postStatus");


    const submitButton =
        document.getElementById("postRequestBtn");



    // =====================================
    // CHARACTER COUNT
    // =====================================

    descriptionInput?.addEventListener(
        "input",
        () => {

            if (charCount) {

                charCount.textContent =
                    `${descriptionInput.value.length}/500`;

            }

        }
    );



    // =====================================
    // STATUS MESSAGE
    // =====================================

    function showPostMessage(
        message,
        error = false
    ) {

        if (!postStatus) {
            return;
        }


        postStatus.textContent =
            message;


        postStatus.style.color =
            error
                ? "#dc3545"
                : "#198754";

    }



    // =====================================
    // SUBMIT REQUEST
    // =====================================

    form.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();



            const selectedService =
                form.querySelector(
                    'input[name="service"]:checked'
                );


            const service =
                selectedService?.value || "";


            const title =
                document
                    .getElementById("requestTitle")
                    ?.value.trim() || "";


            const description =
                document
                    .getElementById("description")
                    ?.value.trim() || "";


            const userLocation =
                document
                    .getElementById("location")
                    ?.value.trim() || "";


            const budget =
                document
                    .getElementById("budget")
                    ?.value.trim() || "";



            // =====================================
            // VALIDATION
            // =====================================

            if (!service) {

                showPostMessage(
                    "Please select a service.",
                    true
                );

                return;

            }


            if (!title) {

                showPostMessage(
                    "Please enter a request title.",
                    true
                );

                document
                    .getElementById("requestTitle")
                    ?.focus();

                return;

            }


            if (!description) {

                showPostMessage(
                    "Please describe the problem.",
                    true
                );

                descriptionInput?.focus();

                return;

            }


            if (!userLocation) {

                showPostMessage(
                    "Please enter your location.",
                    true
                );

                document
                    .getElementById("location")
                    ?.focus();

                return;

            }



            // =====================================
            // SAVE TO FIREBASE
            // =====================================

            try {

                if (submitButton) {

                    submitButton.disabled =
                        true;

                    submitButton.textContent =
                        "Posting...";

                }


                showPostMessage(
                    "Posting your request..."
                );



                const requestDocument =
                    await addDoc(

                        collection(
                            db,
                            "serviceRequests"
                        ),

                        {

                            customerId:
                                ctx.user.uid,


                            customerName:
                                ctx.profile?.displayName ||
                                ctx.user.displayName ||
                                "Customer",


                            customerEmail:
                                ctx.user.email || "",


                            service:
                                service,


                            title:
                                title,


                            description:
                                description,


                           location: userLocation,

latitude: document.getElementById("location").dataset.latitude
  ? Number(document.getElementById("location").dataset.latitude)
  : null,

longitude: document.getElementById("location").dataset.longitude
  ? Number(document.getElementById("location").dataset.longitude)
  : null,

locationAccuracy: document.getElementById("location").dataset.accuracy
  ? Number(document.getElementById("location").dataset.accuracy)
  : null,

budget: budget,


                            status:
                                "open",


                            reactionCount:
                                0,


                            commentCount:
                                0,


                            createdAt:
                                serverTimestamp(),


                            updatedAt:
                                serverTimestamp()

                        }

                    );



                console.log(
                    "Service request created:",
                    requestDocument.id
                );



                showPostMessage(
                    "Request posted successfully!"
                );



                // GO BACK TO HOME PAGE

                setTimeout(
                    () => {

                        window.location.href =
                            "index.html?posted=1";

                    },
                    700
                );


            } catch (error) {

                console.error(
                    "Post request Firebase error:",
                    error
                );


                showPostMessage(
                    error.message ||
                    "Could not post your request.",
                    true
                );


                if (submitButton) {

                    submitButton.disabled =
                        false;

                    submitButton.textContent =
                        "Post Request";

                }

            }

        }
    );

}async function handleBookRepair(ctx) {
  const form = document.querySelector(".book-form");
  if (!form) return;

  const providerId =
    new URLSearchParams(location.search).get("provider");

  const submit = document.getElementById("bookingSubmit");
  const status = document.getElementById("bookingFormStatus");
  const locationButton = form.querySelector(".location-btn");
  const locationBox = form.querySelector(".location-box");
  const photo = document.getElementById("bookingProviderPhoto");
  const fallback = document.getElementById("bookingAvatarFallback");

  let provider = null;
  let submitting = false;
  let saved = false;
  let bookingLocation = null;
  let detecting = false;

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function refreshSubmit() {
    submit.disabled = !provider || submitting || saved;
  }

  function priceLabel(value) {
    if (value === null || value === undefined || value === "") {
      return "Price not provided";
    }

    const number = Number(value);

    if (Number.isFinite(number) && number >= 0) {
      return new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP"
      }).format(number);
    }

    return typeof value === "string"
      ? value
      : "Price not provided";
  }

  function clearProvider(message) {
    provider = null;

    document.getElementById("bookingProviderName").textContent =
      "Provider unavailable";
    document.getElementById("bookingProviderCategory").textContent = "";
    document.getElementById("bookingProviderPrice").textContent = "";
    document.getElementById("bookingEstimatedRate").textContent = "—";

    photo.hidden = true;
    photo.removeAttribute("src");
    fallback.hidden = false;

    showStatus(message);
    refreshSubmit();
  }

  if (!providerId) {
    clearProvider("Please select a provider from Search first.");
    return;
  }

  // Update this page whenever the selected provider's record changes.
  const stopProvider = onSnapshot(
    doc(db, "users", providerId),
    snapshot => {
      if (!snapshot.exists() || snapshot.data().role !== "provider") {
        clearProvider("This provider is no longer available.");
        return;
      }

      provider = snapshot.data();

      const name =
        provider.displayName ||
        provider.fullName ||
        "Name not provided";

      document.getElementById("bookingProviderName").textContent =
        `Book ${name}`;

      document.getElementById("bookingProviderCategory").textContent =
        provider.serviceCategory || "Service not provided";

      const rate = priceLabel(provider.price);

      document.getElementById("bookingProviderPrice").textContent = rate;
      document.getElementById("bookingEstimatedRate").textContent = rate;

      photo.hidden = true;
      fallback.hidden = false;

      photo.onload = () => {
        photo.hidden = false;
        fallback.hidden = true;
      };

      photo.onerror = () => {
        photo.hidden = true;
        fallback.hidden = false;
      };

      photo.alt = name;

      let imageURL = "";

      try {
        const url = new URL(provider.photoURL);
        if (url.protocol === "https:") imageURL = url.href;
      } catch {
        // Keep the person icon when there is no valid photo.
      }

      if (imageURL) {
        photo.src = imageURL;
      } else {
        photo.removeAttribute("src");
      }

      if (!submitting && !saved) showStatus("");
      refreshSubmit();
    },
    error => {
      console.error("Booking provider:", error);
      clearProvider("Could not load the provider. Please refresh to retry.");
    }
  );

  // Keep the location captured for this form, not a previous booking.
  let bookingMap = null;
let bookingMarker = null;
let bookingAccuracyCircle = null;

const locationTitle = document.getElementById("bookingLocationTitle");
const locationName = document.getElementById("bookingLocationName");
const accuracyText = document.getElementById("bookingLocationAccuracy");

function drawBookingMap(latitude, longitude, accuracy) {
  if (!window.L) {
    throw new Error("The map library could not load.");
  }

  document.getElementById("bookingMapWrap").hidden = false;

  if (!bookingMap) {
    bookingMap = L.map("bookingLocationMap", {
      scrollWheelZoom: false
    });

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">' +
          "OpenStreetMap</a> contributors"
      }
    ).addTo(bookingMap);

    // Circle marker avoids missing marker-image errors.
    bookingMarker = L.circleMarker([latitude, longitude], {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#10a995",
      fillOpacity: 1
    })
      .addTo(bookingMap)
      .bindPopup("Your booking location");

    bookingAccuracyCircle = L.circle([latitude, longitude], {
      radius: accuracy,
      color: "#10a995",
      weight: 1,
      fillColor: "#10a995",
      fillOpacity: 0.1
    }).addTo(bookingMap);
  }

  bookingMarker.setLatLng([latitude, longitude]);
  bookingAccuracyCircle
    .setLatLng([latitude, longitude])
    .setRadius(accuracy);

  requestAnimationFrame(() => {
    bookingMap.invalidateSize();
    bookingMap.setView([latitude, longitude], 16);
    bookingMarker.openPopup();
  });
}

locationButton.addEventListener("click", async () => {
  if (detecting || submitting || saved) return;

  if (!navigator.geolocation) {
    locationName.textContent =
      "Your browser does not support location detection.";
    return;
  }

  detecting = true;
  locationButton.disabled = true;
  locationButton.textContent = "Detecting…";

  const previousLocation = bookingLocation;
  locationName.textContent = "Detecting your location…";

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      });
    });

    const { latitude, longitude, accuracy } = position.coords;

    bookingLocation = {
      latitude,
      longitude,
      accuracy,
      address: ""
    };

    locationTitle.textContent = "Location detected";
    accuracyText.textContent =
      `Estimated accuracy: ${Math.round(accuracy)} metres.`;

    try {
      drawBookingMap(latitude, longitude, accuracy);
    } catch (mapError) {
      console.error("Booking map:", mapError);
      accuracyText.textContent +=
        " Map unavailable. Your position was still captured.";
    }

    locationName.textContent = "Finding your location name…";

    try {
      const url = new URL(
        "https://api.bigdatacloud.net/data/reverse-geocode-client"
      );

      url.searchParams.set("latitude", String(latitude));
      url.searchParams.set("longitude", String(longitude));
      url.searchParams.set("localityLanguage", "en");

      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error("Address lookup failed.");
      }

      const data = await response.json();

      const parts = [
        data.locality || data.city,
        data.principalSubdivision
      ]
        .filter(value => typeof value === "string")
        .map(value => value.trim())
        .filter(Boolean);

      const address = [...new Set(parts)].join(", ");

      if (!address) {
        throw new Error("No address name returned.");
      }

      bookingLocation.address = address;
      locationName.textContent = address;
    } catch (addressError) {
      console.error("Booking location name:", addressError);

      locationName.textContent =
        "Position detected. Address name is currently unavailable.";
    }
  } catch (error) {
    console.error("Booking location:", error);

    // Keep an earlier successful detection if a retry fails.
    bookingLocation = previousLocation;

    locationName.textContent =
      (error.code === 1
        ? "Allow location access in your browser, then try again."
        : "Could not detect your location. Please try again.") +
      (previousLocation ? " Your previous detected position is retained." : "");
  } finally {
    detecting = false;
    locationButton.disabled = false;

    locationButton.textContent = bookingLocation
      ? "Detect Again"
      : "Use My Location";
  }
});
window.addEventListener("pagehide", () => {
  if (bookingMap) {
    bookingMap.remove();
    bookingMap = null;
  }
}, { once: true });

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (submitting || saved) return;

    if (!provider) {
      showStatus("Wait for the provider information to load.");
      return;
    }

    const service = document.getElementById("service").value.trim();
    const scheduledAt = document.getElementById("datetime").value;
    const notes = document.getElementById("notes").value.trim();
    const scheduledDate = new Date(scheduledAt);

    if (!service || !scheduledAt) {
      showStatus("Enter the service and preferred date and time.");
      return;
    }

    if (
      Number.isNaN(scheduledDate.getTime()) ||
      scheduledDate.getTime() <= Date.now()
    ) {
      showStatus("Choose a future date and time.");
      return;
    }

    if (!bookingLocation || detecting) {
      showStatus("Please detect your location before submitting.");
      return;
    }

    submitting = true;
    refreshSubmit();
    showStatus("Saving your booking…");

    const selectedProvider = { ...provider };
    const position = { ...bookingLocation };

    try {
      await addDoc(collection(db, "bookings"), {
        customerId: ctx.user.uid,
        customerName:
          ctx.profile?.displayName ||
          ctx.profile?.fullName ||
          ctx.user.displayName ||
          "Customer",

        providerId,
        providerName:
          selectedProvider.displayName ||
          selectedProvider.fullName ||
          "Provider",

        service,
        scheduledAt,
        notes,

      location: position.address || "Address name unavailable",
        latitude: position.latitude,
        longitude: position.longitude,
        locationAccuracy: position.accuracy,

        price: selectedProvider.price ?? "",
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Once saved, prevent another submission even during navigation.
      saved = true;
      showStatus("Booking saved. Opening your pending bookings…");
      location.assign("mybooking.html");
    } catch (error) {
      console.error("Save booking:", error);

      showStatus(
        error.code === "permission-denied"
          ? "Firestore denied this booking. Your booking rules need checking."
          : "Could not save your booking. Please try again."
      );
    } finally {
      submitting = false;
      refreshSubmit();
    }
  });

  window.addEventListener("pagehide", stopProvider, { once: true });
}

function bookingCard(b, providerView = false) {
  const name = providerView ? (b.customerName || "Customer") : (b.providerName || "Provider");
  return `<div class="booking-card firebase-booking" data-booking-id="${escapeHtml(b.id)}" data-status="${escapeHtml(b.status || "pending")}">
    <div class="booking-card-header"><div><h3 class="client-fullname">${escapeHtml(name)}</h3><p class="service-category">${escapeHtml(b.service || "Repair service")}</p></div><span class="status-badge ${escapeHtml(b.status || "pending")}">${escapeHtml(b.status || "pending")}</span></div>
    <div class="booking-card-body"><div class="meta-item"><span>${escapeHtml(b.scheduledAt || "")}</span></div><div class="meta-item"><span>${escapeHtml(b.location || "")}</span></div>${b.price ? `<div class="price-tag">${escapeHtml(String(b.price))}</div>` : ""}</div>
    ${providerView && b.status === "pending" ? `<div class="b-actions-group" style="margin-top:14px"><button class="btn-sm btn-accept-sm" data-action="confirmed">Accept</button><button class="btn-sm btn-decline-sm" data-action="declined">Decline</button></div>` : ""}
  </div>`;
  
}async function handleProviderDashboard(ctx) {
  const status = document.getElementById("providerDashboardStatus");
  const nextHost = document.getElementById("pdNextAppointment");

  if (!status || !nextHost) return;

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  let bookings = [];
  let selectedPeriod = "week";

  const periodSelect = document.getElementById("pdChartPeriod");

  const completedDate = booking =>
    bookingDate(
      booking.customerCompletedAt ||
      booking.completedAt ||
      booking.updatedAt
    );

  function periodStart(period, reference = new Date()) {
    const start = new Date(reference);
    start.setHours(0, 0, 0, 0);

    if (period === "week") {
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    } else if (period === "month") {
      start.setDate(1);
    } else if (period === "year") {
      start.setMonth(0, 1);
    } else {
      const months = Number.parseInt(period, 10) || 2;
      start.setDate(1);
      start.setMonth(start.getMonth() - months + 1);
    }

    return start;
  }

  function renderTrend(id, current, previous, suffix) {
    const element = document.getElementById(id);
    if (!element) return;

    // With no previous bookings, a percentage would be misleading.
    if (previous === 0) {
      element.hidden = current === 0;
      element.dataset.direction = "same";
      element.textContent = current ? `↑ ${current} ${suffix}` : "";
      return;
    }

    const percent = Math.round(((current - previous) / previous) * 100);
    const direction = percent > 0 ? "up" : percent < 0 ? "down" : "same";

    element.hidden = false;
    element.dataset.direction = direction;
    element.textContent =
      `${percent > 0 ? "↑" : percent < 0 ? "↓" : "→"} ` +
      `${Math.abs(percent)}% vs ${suffix}`;
  }

  function renderCompletedChart() {
    const now = new Date();
    const start = periodStart(selectedPeriod, now);
    const previousStart = new Date(start);

    if (selectedPeriod === "week") previousStart.setDate(start.getDate() - 7);
    else if (selectedPeriod === "month") previousStart.setMonth(start.getMonth() - 1);
    else if (selectedPeriod === "year") previousStart.setFullYear(start.getFullYear() - 1);
    else {
      const months = Number.parseInt(selectedPeriod, 10) || 2;
      previousStart.setMonth(start.getMonth() - months);
    }

    const completed = bookings
      .filter(booking => booking.status === "completed")
      .map(completedDate)
      .filter(Boolean);

    const current = completed.filter(date => date >= start && date <= now);
    const previous = completed.filter(
      date => date >= previousStart && date < start
    );

    setText("pdCompletedCount", current.length);
    setText(
      "pdCompletedPeriod",
      selectedPeriod === "week" ? "this week" :
      selectedPeriod === "month" ? "this month" :
      selectedPeriod === "year" ? "this year" :
      `in the last ${Number.parseInt(selectedPeriod, 10)} months`
    );

    renderTrend(
      "pdCompletedTrend",
      current.length,
      previous.length,
      selectedPeriod === "week" ? "last week" : "previous period"
    );

    const chart = document.getElementById("pdCompletedBars");
    if (!chart) return;

    chart.replaceChildren();

    // Seven bars represent the selected period.
    const periodEnd = new Date(now);
    const duration = Math.max(1, periodEnd - start);
    const counts = Array(7).fill(0);

    current.forEach(date => {
      const index = Math.min(
        6,
        Math.max(0, Math.floor(((date - start) / duration) * 7))
      );
      counts[index]++;
    });

    const labels = selectedPeriod === "week"
      ? ["M", "T", "W", "T", "F", "S", "S"]
      : ["1", "2", "3", "4", "5", "6", "7"];

    const maximum = Math.max(1, ...counts);

    counts.forEach((count, index) => {
      const column = document.createElement("div");
      column.className = "pd-bar-column";

      const track = document.createElement("div");
      track.className = "pd-bar-track";

      const fill = document.createElement("div");
      fill.className = "pd-bar-fill";
      fill.style.height = `${(count / maximum) * 100}%`;
      fill.title = `${count} completed bookings`;

      const label = document.createElement("span");
      label.textContent = labels[index];

      track.append(fill);
      column.append(track, label);
      chart.append(column);
    });
  }

  periodSelect?.addEventListener("change", () => {
    selectedPeriod = periodSelect.value;
    renderCompletedChart();
  });

  let lastSavedCompletedCount = null;

  function bookingDate(value) {
    if (!value) return null;
    const date = value.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function renderOverview() {
    const now = new Date();

    const pending = bookings.filter(
      booking => booking.status === "pending"
    );
    const confirmed = bookings.filter(
      booking => booking.status === "confirmed"
    );

    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const countCreated = (start, end) =>
      bookings.filter(booking => {
        const date = bookingDate(booking.createdAt);
        return date && date >= start && date < end;
      }).length;

    const thisMonth = countCreated(thisMonthStart, now);
    const lastMonth = countCreated(lastMonthStart, thisMonthStart);

    setText("providerBookingCount", bookings.length);
    setText("providerMonthCount", thisMonth);
    setText("pdPending", pending.length);
    setText("pdConfirmed", confirmed.length);

    renderTrend("pdMonthTrend", thisMonth, lastMonth, "last month");

    const weekStart = periodStart("week", now);
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    renderTrend(
      "pdTotalTrend",
      countCreated(weekStart, now),
      countCreated(lastWeekStart, weekStart),
      "last week"
    );

    renderCompletedChart();

    const upcoming = confirmed
      .map(booking => ({
        ...booking,
        date: bookingDate(booking.scheduledAt)
      }))
      .filter(booking => booking.date && booking.date >= now)
      .sort((a, b) => a.date - b.date);

    nextHost.replaceChildren();

    if (!upcoming.length) {
      const empty = document.createElement("p");
      empty.className = "pd-muted";
      empty.textContent = "No upcoming confirmed appointments.";
      nextHost.append(empty);
      return;
    }

    const booking = upcoming[0];

    const name = document.createElement("h3");
    name.textContent = booking.customerName || "Customer";

    const service = document.createElement("p");
    service.textContent = booking.service || "Service not provided";

    const schedule = document.createElement("p");
    schedule.className = "pd-next-date";
    schedule.textContent = booking.date.toLocaleString("en-PH", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });

    const locationText = document.createElement("p");
    locationText.className = "pd-muted";
    locationText.textContent =
      booking.location || "Location not provided";

    nextHost.append(name, service, schedule, locationText);
  }

   

  const stopProfile = onSnapshot(
    doc(db, "users", ctx.user.uid),
    snapshot => {
      const profile = snapshot.data() || {};

      setText(
        "providerDashboardName",
        profile.displayName || profile.fullName || "Name not provided"
      );

      setText(
        "providerDashboardService",
        profile.serviceCategory || "Service category not provided"
      );

      void displayServiceLocation(profile, [
        document.getElementById("providerDashboardLocation")
      ]);

      setText(
        "providerDashboardAvailability",
        profile.available === true ? "● Online" : "● Offline"
      );

      const avatar = document.getElementById("providerDashboardAvatar");
      if (avatar && typeof profile.photoURL === "string") {
        try {
          const imageURL = new URL(profile.photoURL);
          if (imageURL.protocol === "https:") {
            const image = document.createElement("img");
            image.alt = "";
            image.src = imageURL.href;
            avatar.replaceChildren(image);
          }
        } catch {
          // Keep the default icon.
        }
      }
      // The rating is loaded live from providerReviews below.
    },
    error => {
      console.error("Dashboard profile:", error);
      setText("providerDashboardName", "Profile unavailable");
    
    }
  );

  const stopReviews = onSnapshot(
    query(
      collection(db, "providerReviews"),
      where("providerId", "==", ctx.user.uid)
    ),
    snapshot => {
      const ratings = snapshot.docs
        .map(item => Number(item.data().rating))
        .filter(rating =>
          Number.isFinite(rating) &&
          rating >= 1 &&
          rating <= 5
        );

      const average = ratings.length
        ? ratings.reduce((sum, rating) => sum + rating, 0) /
          ratings.length
        : null;

      setText(
        "providerDashboardRating",
        average === null ? "—" : average.toFixed(1)
      );

      const reviewCount = document.getElementById("pdReviewCount");
      if (reviewCount) {
        reviewCount.hidden = false;
        reviewCount.textContent =
          `${ratings.length} ${ratings.length === 1 ? "review" : "reviews"}`;
      }
    },
    error => {
      console.error("Dashboard ratings:", error);
      setText("providerDashboardRating", "—");

      const reviewCount = document.getElementById("pdReviewCount");
      if (reviewCount) reviewCount.hidden = true;
    }
  );

  // Heartbeat while this provider dashboard is open and visible.
  const presenceRef = doc(db, "users", ctx.user.uid);
  const presenceLabel = document.getElementById("pdPresenceStatus");

  function showPresence(online) {
    if (presenceLabel) {
      presenceLabel.textContent = online ? "● Online" : "● Offline";
    }
  }

  async function updatePresence(online) {
    showPresence(online);

    try {
      await updateDoc(presenceRef, {
        isOnline: online,
        lastSeenAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Provider presence:", error);
    }
  }

  const refreshPresence = () => {
    updatePresence(document.visibilityState === "visible");
  };

  refreshPresence();
  document.addEventListener("visibilitychange", refreshPresence);

  // Refresh lastSeenAt so other pages can detect an abruptly closed tab.
  const presenceClock = setInterval(() => {
    if (document.visibilityState === "visible") {
      updatePresence(true);
    }
  }, 30000);

  const stopBookings = onSnapshot(
    query(
      collection(db, "bookings"),
      where("providerId", "==", ctx.user.uid)
    ),
    snapshot => {
      bookings = snapshot.docs.map(document => ({
        ...document.data(),
        id: document.id
      }));

      const completedCount = bookings.filter(
        booking => booking.status === "completed"
      ).length;

      if (completedCount !== lastSavedCompletedCount) {
        lastSavedCompletedCount = completedCount;

        updateDoc(doc(db, "users", ctx.user.uid), {
          completedJobs: completedCount
        }).catch(error => {
          lastSavedCompletedCount = null;
          console.error("Save completed booking count:", error);
        });
      }

      status.hidden = true;
      renderOverview();
    },
    error => {
      console.error("Dashboard bookings:", error);

      status.hidden = false;
      status.textContent =
        "Could not load your bookings. Please refresh to retry.";

      [
        "providerBookingCount",
        "providerMonthCount",
        "pdPending",
        "pdConfirmed"
      ].forEach(id => setText(id, "—"));

      nextHost.textContent = "Schedule unavailable.";
    }
  );

  // Live unread notification count; the bell remains a normal link.
  const bell = document.querySelector(
    '.header-actions a[href="notification.html"]'
  );

  let badge = bell?.querySelector(".notification-badge");

  if (bell && !badge) {
    badge = document.createElement("span");
    badge.className = "notification-badge";
    badge.hidden = true;
    bell.append(badge);
  }

  const stopNotifications = onSnapshot(
    query(
      collection(db, "notifications"),
      where("userId", "==", ctx.user.uid)
    ),
    snapshot => {
      const unread = snapshot.docs.filter(
        document => document.data().read === false
      ).length;

      if (badge) {
        badge.hidden = unread === 0;
        badge.textContent = unread > 99 ? "99+" : String(unread);
      }

      bell?.setAttribute(
        "aria-label",
        unread ? `Notifications, ${unread} unread` : "Notifications"
      );
    },
    error => {
      console.error("Dashboard notifications:", error);
      if (badge) badge.hidden = true;
    }
  );

  // Refresh the next appointment as time passes.
  const clock = setInterval(renderOverview, 60000);

  window.addEventListener("pagehide", () => {
    stopProfile();
    stopReviews();
    stopBookings();
    stopNotifications();
    clearInterval(clock);
    clearInterval(presenceClock);
    document.removeEventListener("visibilitychange", refreshPresence);
    updatePresence(false);
  }, { once: true });
}// ==========================================
// PROVIDER STEP 1
// PERSONAL INFO + LEAFLET LOCATION
// ==========================================

async function handleProviderStep1(ctx) {

    const form =
        document.getElementById("providerStep1Form")
        || document.querySelector(".provider-form");


    if (!form) {
        return;
    }


    const fullNameInput =
        document.getElementById(
            "providerFullName"
        );

const shopNameInput =
    document.getElementById("providerShopName");
    const contactInput =
        document.getElementById(
            "providerContactNumber"
        );


    const detectButton =
        document.getElementById(
            "detectProviderLocation"
        );


    const locationTitle =
        document.getElementById(
            "providerLocationTitle"
        );


    const locationText =
        document.getElementById(
            "providerLocationText"
        );


    const coordinatesText =
        document.getElementById(
            "providerCoordinates"
        );


    const mapElement =
        document.getElementById(
            "providerLocationMap"
        );


    const latitudeInput =
        document.getElementById(
            "providerLatitude"
        );


    const longitudeInput =
        document.getElementById(
            "providerLongitude"
        );


    let providerMap = null;

    let providerMarker = null;

    let selectedLatitude = null;

    let selectedLongitude = null;



    // ========================================
    // PRE-FILL USER NAME
    // ========================================

    if (fullNameInput) {

        fullNameInput.value =
            ctx.profile?.displayName
            || ctx.user.displayName
            || "";

    } const shopName = shopNameInput?.value.trim() || "";

if (!shopName) {
    flash("Please enter the name of your shop.", "error");
    shopNameInput?.focus();
    return;
}

    // ========================================
    // SAVE COORDINATES
    // ========================================

    function updateSelectedLocation(
        latitude,
        longitude
    ) {

        selectedLatitude =
            Number(latitude);


        selectedLongitude =
            Number(longitude);


        if (latitudeInput) {

            latitudeInput.value =
                selectedLatitude;

        }


        if (longitudeInput) {

            longitudeInput.value =
                selectedLongitude;

        }


        const coordinateValue =
            `${selectedLatitude.toFixed(6)}, ${selectedLongitude.toFixed(6)}`;


        if (locationTitle) {

            locationTitle.textContent =
                "Location detected";

        }


        if (locationText) {

            locationText.textContent =
                "Move the marker if you want to adjust your service location.";

        }


        if (coordinatesText) {

            coordinatesText.textContent =
                ` ${coordinateValue}`;

            coordinatesText.style.display =
                "block";

        }

    }



    // ========================================
    // CREATE LEAFLET MAP
    // ========================================

    function showProviderMap(
        latitude,
        longitude
    ) {

        if (!mapElement) {

            console.error(
                "providerLocationMap element missing."
            );

            return;
        }


        if (!window.L) {

            console.error(
                "Leaflet was not loaded."
            );


            flash(
                "Map could not load. Please check your internet connection.",
                "error"
            );


            return;
        }


        mapElement.style.display =
            "block";


        if (!providerMap) {


            providerMap =
                L.map(
                    mapElement,
                    {
                        zoomControl:
                            true
                    }
                )
                .setView(
                    [
                        latitude,
                        longitude
                    ],
                    16
                );


            L.tileLayer(
                "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                {

                    maxZoom:
                        19,

                    attribution:
                        '&copy; OpenStreetMap contributors'

                }
            )
            .addTo(
                providerMap
            );



            providerMarker =
                L.marker(
                    [
                        latitude,
                        longitude
                    ],
                    {
                        draggable:
                            true
                    }
                )
                .addTo(
                    providerMap
                );


            providerMarker
                .bindPopup(
                    "Your service location"
                )
                .openPopup();



            // DRAG MARKER
providerMarker.on(
    "dragend",
    event => {

        const position =
            event.target.getLatLng();

        updateSelectedLocation(
            position.lat,
            position.lng
        );

    }
);



            // CLICK MAP TO MOVE PIN

           providerMap.on(
    "click",
    event => {

        providerMarker.setLatLng(
            event.latlng
        );

        updateSelectedLocation(
            event.latlng.lat,
            event.latlng.lng
        );

    }
);


        } else {


            providerMap.setView(
                [
                    latitude,
                    longitude
                ],
                16
            );


            providerMarker.setLatLng(
                [
                    latitude,
                    longitude
                ]
            );

        }



        setTimeout(
            () => {

                providerMap.invalidateSize();

            },
            200
        );

    }



    // ========================================
    // DETECT DEVICE GPS
    // ========================================

   navigator.geolocation.getCurrentPosition(

    position => {

        const latitude =
            position.coords.latitude;

        const longitude =
            position.coords.longitude;


        updateSelectedLocation(
            latitude,
            longitude
        );


        showProviderMap(
            latitude,
            longitude
        );


        detectButton.disabled =
            false;


        flash(
            "Location detected successfully."
        );

    },


    error => {

        console.error(
            "Provider location error:",
            error
        );


        detectButton.disabled =
            false;


        // ==============================
        // LOCATION PERMISSION DENIED
        // ==============================

        if (
            error.code ===
            error.PERMISSION_DENIED
        ) {

            if (locationTitle) {

                locationTitle.textContent =
                    "Choose Your Location";

            }


            if (locationText) {

                locationText.textContent =
                    "Location permission is blocked. Tap or drag the marker on the map.";

            }


            // Default map view:
            // Sipocot, Camarines Sur

            const fallbackLatitude =
                13.7684;

            const fallbackLongitude =
                122.9764;


            showProviderMap(
                fallbackLatitude,
                fallbackLongitude
            );


            flash(
                "Select your location manually on the map.",
                "error"
            );


            return;
        }



        // ==============================
        // LOCATION UNAVAILABLE
        // ==============================

        if (
            error.code ===
            error.POSITION_UNAVAILABLE
        ) {

            if (locationTitle) {

                locationTitle.textContent =
                    "Location unavailable";

            }


            const fallbackLatitude =
                13.7684;

            const fallbackLongitude =
                122.9764;


            showProviderMap(
                fallbackLatitude,
                fallbackLongitude
            );


            flash(
                "Your GPS location is unavailable. Select your location manually on the map.",
                "error"
            );


            return;
        }



        // ==============================
        // GPS TIMEOUT
        // ==============================

        if (
            error.code ===
            error.TIMEOUT
        ) {

            if (locationTitle) {

                locationTitle.textContent =
                    "Location timed out";

            }


            const fallbackLatitude =
                13.7684;

            const fallbackLongitude =
                122.9764;


            showProviderMap(
                fallbackLatitude,
                fallbackLongitude
            );


            flash(
                "GPS timed out. Select your location manually on the map.",
                "error"
            );


            return;
        }



        flash(
            "Could not detect your location.",
            "error"
        );

    },


    {
        enableHighAccuracy:
            true,

        timeout:
            20000,

        maximumAge:
            0
    }

);


    // ========================================
    // NEXT STEP
    // ========================================

    form.addEventListener(
        "submit",
        event => {


            event.preventDefault();


            const fullName =
                fullNameInput
                    ?.value
                    .trim()
                || "";


            const contactNumber =
                contactInput
                    ?.value
                    .trim()
                || "";


            if (!fullName) {

                flash(
                    "Please enter your full name.",
                    "error"
                );

                fullNameInput?.focus();

                return;
            }


            if (!contactNumber) {

                flash(
                    "Please enter your contact number.",
                    "error"
                );

                contactInput?.focus();

                return;
            }


            if (
                !Number.isFinite(
                    selectedLatitude
                )
                ||
                !Number.isFinite(
                    selectedLongitude
                )
            ) {

                flash(
                    "Please detect your location first.",
                    "error"
                );

                return;
            }



            const draft =
                JSON.parse(
                    localStorage.getItem(
                        "reparoProviderDraft"
                    )
                    || "{}"
                );


            draft.fullName =
                fullName;

            draft.shopName = shopName;
            draft.contactNumber =
                contactNumber;


            draft.latitude =
                selectedLatitude;


            draft.longitude =
                selectedLongitude;


            draft.location =
                `${selectedLatitude.toFixed(6)}, ${selectedLongitude.toFixed(6)}`;


            localStorage.setItem(
                "reparoProviderDraft",
                JSON.stringify(
                    draft
                )
            );


            window.location.href =
                "be-provider2.html";   }
    );

}
async function handleProviderStep2() {

    const form =
        document.querySelector(".provider-form");

    if (!form) {
        return;
    }


    const serviceSelect =
        document.getElementById(
            "providerServiceCategory"
        );

    const otherServiceGroup =
        document.getElementById(
            "otherServiceGroup"
        );

    const otherServiceInput =
        document.getElementById(
            "otherServiceInput"
        );

    const skillInput =
        document.getElementById(
            "skillInput"
        );

    const addSkillButton =
        document.getElementById(
            "addSkillButton"
        );

    const skillsList =
        document.getElementById(
            "skillsList"
        );

    const skillCount =
        document.getElementById(
            "skillCount"
        );

    const textarea =
        form.querySelector(
            ".service-textarea"
        );

    const charCounter =
        form.querySelector(
            ".char-counter"
        );


    let skills = [];


    // ==========================================
    // OTHER SERVICE
    // ==========================================

    function handleOtherService() {

        if (!serviceSelect) {
            return;
        }


        if (
            serviceSelect.value ===
            "other"
        ) {

            if (otherServiceGroup) {

                otherServiceGroup.style.display =
                    "block";

            }


            if (otherServiceInput) {

                otherServiceInput.required =
                    true;

                otherServiceInput.focus();

            }

        } else {

            if (otherServiceGroup) {

                otherServiceGroup.style.display =
                    "none";

            }


            if (otherServiceInput) {

                otherServiceInput.required =
                    false;

                otherServiceInput.value =
                    "";

            }

        }

    }


    serviceSelect?.addEventListener(
        "change",
        handleOtherService
    );



    // ==========================================
    // DISPLAY SKILLS BELOW INPUT
    // ==========================================

    function renderSkills() {

        if (!skillsList) {
            return;
        }


        skillsList.innerHTML =
            "";


        skills.forEach(
            (skill, index) => {

                const skillTag =
                    document.createElement(
                        "div"
                    );


                skillTag.className =
                    "skill-tag";


                const skillText =
                    document.createElement(
                        "span"
                    );


                skillText.textContent =
                    skill;


                const removeButton =
                    document.createElement(
                        "button"
                    );


                removeButton.type =
                    "button";


                removeButton.className =
                    "remove-skill-btn";


                removeButton.innerHTML =
                    "&times;";


                removeButton.addEventListener(
                    "click",
                    () => {

                        skills.splice(
                            index,
                            1
                        );


                        renderSkills();

                    }
                );


                skillTag.appendChild(
                    skillText
                );


                skillTag.appendChild(
                    removeButton
                );


                skillsList.appendChild(
                    skillTag
                );

            }
        );


        if (skillCount) {

            skillCount.textContent =
                `(${skills.length}/8)`;

        }


        if (addSkillButton) {

            addSkillButton.disabled =
                skills.length >= 8;

        }

    }



    // ==========================================
    // ADD SKILL
    // ==========================================

    function addSkill() {

        if (!skillInput) {
            return;
        }


        const skill =
            skillInput.value.trim();


        if (!skill) {

            skillInput.focus();

            return;
        }


        if (
            skills.length >= 8
        ) {

            flash(
                "Maximum of 8 skills only.",
                "error"
            );

            return;
        }


        const duplicate =
            skills.some(
                existingSkill =>
                    existingSkill
                        .toLowerCase()
                        ===
                    skill.toLowerCase()
            );


        if (duplicate) {

            flash(
                "This skill is already added.",
                "error"
            );

            skillInput.value =
                "";

            skillInput.focus();

            return;
        }


        skills.push(
            skill
        );


        skillInput.value =
            "";


        renderSkills();


        skillInput.focus();

    }



    addSkillButton?.addEventListener(
        "click",
        addSkill
    );


    skillInput?.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Enter"
            ) {

                event.preventDefault();

                addSkill();

            }

        }
    );



    // ==========================================
    // TEXTAREA COUNTER
    // ==========================================

    textarea?.addEventListener(
        "input",
        () => {

            if (charCounter) {

                charCounter.textContent =
                    `${textarea.value.length}/500`;

            }

        }
    );



    // ==========================================
    // LOAD SAVED DRAFT
    // ==========================================

    const savedDraft =
        JSON.parse(
            localStorage.getItem(
                "reparoProviderDraft"
            )
            || "{}"
        );


    if (
        Array.isArray(
            savedDraft.skills
        )
    ) {

        skills =
            savedDraft.skills.slice(
                0,
                8
            );


        renderSkills();

    }



    // ==========================================
    // NEXT BUTTON
    // ==========================================

    form.addEventListener(
        "submit",
        event => {

            event.preventDefault();


            if (!serviceSelect?.value) {

                flash(
                    "Please select a service category.",
                    "error"
                );

                return;
            }


            let serviceCategory =
                serviceSelect.value;


            let customService =
                "";


            if (
                serviceCategory ===
                "other"
            ) {

                customService =
                    otherServiceInput
                        ?.value
                        .trim()
                    || "";


                if (!customService) {

                    flash(
                        "Please enter your service.",
                        "error"
                    );

                    otherServiceInput?.focus();

                    return;
                }


                serviceCategory =
                    customService;

            }


            if (
                skills.length === 0
            ) {

                flash(
                    "Please add at least one skill.",
                    "error"
                );

                skillInput?.focus();

                return;
            }


            const bio =
                textarea
                    ?.value
                    .trim()
                || "";


            if (!bio) {

                flash(
                    "Please describe your service.",
                    "error"
                );

                return;
            }


            const draft =
                JSON.parse(
                    localStorage.getItem(
                        "reparoProviderDraft"
                    )
                    || "{}"
                );


            draft.serviceCategory =
                serviceCategory;


            draft.serviceCategoryKey =
                serviceSelect.value;


            draft.customService =
                customService;


            draft.skills =
                skills;


            draft.bio =
                bio;


            localStorage.setItem(
                "reparoProviderDraft",
                JSON.stringify(
                    draft
                )
            );


            window.location.href =
                "be-provider3.html";

        }
    );


    handleOtherService();

    renderSkills();
  }
async function handleProviderStep3(ctx) {

    const form =
        document.getElementById(
            "providerStep3Form"
        );


    if (!form) {
        return;
    }


    const profileInput =
        document.getElementById(
            "providerProfilePhoto"
        );


    const permitInput =
        document.getElementById(
            "providerPermitFile"
        );


    const expiryInput =
        document.getElementById(
            "providerPermitExpiry"
        );


    const submitButton =
        document.getElementById(
            "submitProviderApplication"
        );



    form.addEventListener(
        "submit",
        async event => {


            event.preventDefault();


            const profilePhoto =
                profileInput
                    ?.files
                    ?.[0];


            const permitFile =
                permitInput
                    ?.files
                    ?.[0];


            const expiry =
                expiryInput
                    ?.value
                || "";



            // ======================================
            // VALIDATION
            // ======================================

            if (!profilePhoto) {

                flash(
                    "Please upload your profile photo.",
                    "error"
                );

                return;
            }


            if (!permitFile) {

                flash(
                    "Please upload your business permit.",
                    "error"
                );

                return;
            }


            if (!expiry) {

                flash(
                    "Please select the permit expiry date.",
                    "error"
                );

                return;
            }



            // Profile max 5MB

            if (
                profilePhoto.size >
                5 * 1024 * 1024
            ) {

                flash(
                    "Profile photo must be 5MB or smaller.",
                    "error"
                );

                return;
            }



            // Permit max 10MB

            if (
                permitFile.size >
                10 * 1024 * 1024
            ) {

                flash(
                    "Business permit must be 10MB or smaller.",
                    "error"
                );

                return;
            }



            // Validate profile image

            const allowedProfileTypes =
                [
                    "image/jpeg",
                    "image/png",
                    "image/webp"
                ];


            if (
                !allowedProfileTypes.includes(
                    profilePhoto.type
                )
            ) {

                flash(
                    "Profile photo must be JPG, PNG, or WEBP.",
                    "error"
                );

                return;
            }



            // Validate permit type

            const allowedPermitTypes =
                [
                    "image/jpeg",
                    "image/png",
                    "image/webp",
                    "application/pdf"
                ];


            if (
                !allowedPermitTypes.includes(
                    permitFile.type
                )
            ) {

                flash(
                    "Business permit must be JPG, PNG, WEBP, or PDF.",
                    "error"
                );

                return;
            }



            try {


                if (submitButton) {

                    submitButton.disabled =
                        true;


                    submitButton.textContent =
                        "Submitting...";

                }


                flash(
                    "Uploading provider documents..."
                );



                // ======================================
                // LOAD STEP 1 + STEP 2
                // ======================================

                const draft =
                    JSON.parse(

                        localStorage.getItem(
                            "reparoProviderDraft"
                        )

                        ||

                        "{}"

                    );


               if (
    !draft.fullName
    ||
    !draft.shopName
    ||
    !draft.serviceCategory
) {

                    throw new Error(
                        "Provider information is incomplete. Please complete Steps 1 and 2."
                    );

                }



                // ======================================
                // UPLOAD PROFILE PHOTO
                // ======================================

                const profileUpload =
                    await uploadToCloudinary(

                        profilePhoto,

                        `reparo/provider-applications/${ctx.user.uid}/profile`

                    );



                // ======================================
                // UPLOAD BUSINESS PERMIT
                // ======================================

                const permitUpload =
                    await uploadToCloudinary(

                        permitFile,

                        `reparo/provider-applications/${ctx.user.uid}/permits`

                    );



                // ======================================
                // SAVE TO FIRESTORE
                // ======================================

                await setDoc(

                    doc(
                        db,
                        "providerApplications",
                        ctx.user.uid
                    ),

                    {

                        // USER

                        ownerId:
                            ctx.user.uid,


                        email:
                            ctx.user.email
                            ||
                            "",



                        // PERSONAL INFO

                        fullName:
                            draft.fullName
                            ||
                            "",

                      shopName:
                  draft.shopName
                      ||
                      "",
                        contactNumber:
                            draft.contactNumber
                            ||
                            "",



                        // SERVICE

                        serviceCategory:
                            draft.serviceCategory
                            ||
                            "",


                        serviceCategoryKey:
                            draft.serviceCategoryKey
                            ||
                            "",


                        customService:
                            draft.customService
                            ||
                            "",


                        skills:
                            Array.isArray(
                                draft.skills
                            )
                                ?
                                draft.skills
                                :
                                [],


                        bio:
                            draft.bio
                            ||
                            "",


                        price:
                            Number(
                                draft.price
                                ||
                                0
                            ),



                        // LOCATION

                        location:
                            draft.location
                            ||
                            "",


                        latitude:
                            Number(
                                draft.latitude
                            ),


                        longitude:
                            Number(
                                draft.longitude
                            ),



                        // CLOUDINARY PROFILE

                        photoURL:
                            profileUpload.url,


                        photoPublicId:
                            profileUpload.publicId,


                        photoAssetId:
                            profileUpload.assetId,



                        // CLOUDINARY PERMIT

                        permitURL:
                            permitUpload.url,


                        permitPublicId:
                            permitUpload.publicId,


                        permitAssetId:
                            permitUpload.assetId,


                        permitResourceType:
                            permitUpload.resourceType,


                        permitExpiry:
                            expiry,



                        // APPLICATION

                        status:
                            "pending",


                        submittedAt:
                            serverTimestamp(),


                        updatedAt:
                            serverTimestamp()

                    },

                    {
                        merge:
                            true
                    }

                );



                // ======================================
                // ACTIVITY LOG
                // ======================================

                await logActivity(

                    ctx.user.uid,

                    "Submitted provider application",

                    draft.serviceCategory
                    ||
                    ""

                );



                // Only clear AFTER Firestore succeeds

                localStorage.removeItem(
                    "reparoProviderDraft"
                );



                flash(
                    "Application submitted successfully!"
                );



                setTimeout(
                    () => {

                        window.location.href =
                            "application-done.html";

                    },
                    700
                );


            } catch (error) {


                console.error(
                    "Provider application submission error:",
                    error
                );


                if (submitButton) {

                    submitButton.disabled =
                        false;


                    submitButton.textContent =
                        "Submit Application";

                }


                flash(
                    error.message
                    ||
                    "Could not submit provider application.",
                    "error"
                );

            }

        }
    );

}
// ==========================================
// CLOUDINARY FILE UPLOAD
// ==========================================

async function uploadToCloudinary(
    file,
    folder = "reparo/provider-applications"
) {

    if (!file) {

        throw new Error(
            "No file selected."
        );

    }


    const {
        cloudName,
        uploadPreset
    } = CLOUDINARY_CONFIG;


    if (
        !cloudName
        ||
        cloudName === "YOUR_CLOUD_NAME"
        ||
        !uploadPreset
    ) {

        throw new Error(
            "Cloudinary configuration is incomplete."
        );

    }


    const formData =
        new FormData();


    formData.append(
        "file",
        file
    );


    formData.append(
        "upload_preset",
        uploadPreset
    );


    formData.append(
        "folder",
        folder
    );


    const endpoint =
        `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;


    const response =
        await fetch(
            endpoint,
            {
                method:
                    "POST",

                body:
                    formData
            }
        );


    const result =
        await response.json();


    if (!response.ok) {

        console.error(
            "Cloudinary upload response:",
            result
        );


        throw new Error(
            result?.error?.message
            ||
            "Cloudinary upload failed."
        );

    }


    if (!result.secure_url) {

        throw new Error(
            "Cloudinary did not return a file URL."
        );

    }


    return {

        url:
            result.secure_url,

        publicId:
            result.public_id || "",

        assetId:
            result.asset_id || "",

        resourceType:
            result.resource_type || "",

        format:
            result.format || ""

    };

}
async function loadProviders() {

    const snapshot =
        await getDocs(

            query(
                collection(
                    db,
                    "users"
                ),

                where(
                    "role",
                    "==",
                    "provider"
                )
            )

        );


    return snapshot.docs

        .map(
            providerDoc => ({
                id:
                    providerDoc.id,

                ...providerDoc.data()
            })
        )

        .filter(
            provider =>
                provider.verified === true
        );

}//=====================================
// CUSTOMER SEARCH + FIRESTORE SEARCH HISTORY
// ==========================================

async function handleSearch(ctx) {

  const form =
    document.getElementById("searchForm")
    || document.querySelector("form.search-box");

  const searchInput =
    document.getElementById("searchInput")
    || form?.querySelector("input");

  const recentSearchList =
    document.getElementById("recentSearchList");

  const clearButton =
    document.getElementById("clearRecentSearches");


  if (!form || !searchInput) {
    return;
  }


  // ========================================
  // LOAD RECENT SEARCHES FROM FIRESTORE
  // ========================================

  async function loadRecentSearches() {

    if (!recentSearchList) {
      return;
    }


    try {

      const searchQuery =
        query(
          collection(db, "searchHistory"),
          where(
            "userId",
            "==",
            ctx.user.uid
          )
        );


      const snapshot =
        await getDocs(searchQuery);


      const searches =
        snapshot.docs
          .map(searchDoc => ({
            id: searchDoc.id,
            ...searchDoc.data()
          }))
          .sort((a, b) => {

            const aTime =
              a.createdAt?.seconds || 0;

            const bTime =
              b.createdAt?.seconds || 0;

            return bTime - aTime;

          })
          .slice(0, 5);


      recentSearchList.innerHTML = "";


      if (searches.length === 0) {

        recentSearchList.innerHTML = `

          <p
            style="
              color:#7b8490;
              font-size:12px;
              padding:10px 0;
              margin:0;
            "
          >
            No recent searches yet.
          </p>

        `;

        return;
      }


      searches.forEach(search => {

        const item =
          document.createElement("a");


        item.className =
          "recent-item";


        item.href =
          `search-results.html?q=${encodeURIComponent(search.term)}`;


        item.style.textDecoration =
          "none";

        item.style.color =
          "inherit";


        item.innerHTML = `

          <div class="icon-circle">

            <svg viewBox="0 0 24 24">

              <path
                d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"
              />

            </svg>

          </div>

          <span></span>

        `;


        item.querySelector("span").textContent =
          search.term;


        recentSearchList.appendChild(item);

      });


    } catch (error) {

      console.error(
        "Could not load search history:",
        error
      );


      recentSearchList.innerHTML = `

        <p
          style="
            color:#dc3545;
            font-size:12px;
            padding:10px 0;
          "
        >
          Could not load recent searches.
        </p>

      `;
    }
  }



  // ========================================
  // SAVE SEARCH TO FIRESTORE
  // ========================================

  async function saveSearch(term) {

    const cleanTerm =
      String(term || "").trim();


    if (!cleanTerm) {
      return;
    }


    const normalizedTerm =
      cleanTerm.toLowerCase();


    // Get this user's existing search history
    const searchQuery =
      query(
        collection(db, "searchHistory"),
        where(
          "userId",
          "==",
          ctx.user.uid
        )
      );


    const snapshot =
      await getDocs(searchQuery);


    // Remove same search if it already exists
    const duplicates =
      snapshot.docs.filter(searchDoc => {

        const data =
          searchDoc.data();

        return (
          data.normalizedTerm ===
          normalizedTerm
        );

      });


    for (const duplicate of duplicates) {

      await deleteDoc(
        doc(
          db,
          "searchHistory",
          duplicate.id
        )
      );

    }


    // Save newest search
    await addDoc(
      collection(
        db,
        "searchHistory"
      ),
      {

        userId:
          ctx.user.uid,

        term:
          cleanTerm,

        normalizedTerm:
          normalizedTerm,

        createdAt:
          serverTimestamp()

      }
    );


    // Keep only latest 5 searches
    const updatedSnapshot =
      await getDocs(searchQuery);


    const allSearches =
      updatedSnapshot.docs
        .map(searchDoc => ({
          id: searchDoc.id,
          ...searchDoc.data()
        }))
        .sort((a, b) => {

          const aTime =
            a.createdAt?.seconds || 0;

          const bTime =
            b.createdAt?.seconds || 0;

          return bTime - aTime;

        });


    const oldSearches =
      allSearches.slice(5);


    for (const oldSearch of oldSearches) {

      await deleteDoc(
        doc(
          db,
          "searchHistory",
          oldSearch.id
        )
      );

    }
  }



  // ========================================
  // SEARCH SUBMIT
  // ========================================

  form.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const term =
        searchInput.value.trim();


      if (!term) {

        searchInput.focus();

        return;
      }


      try {

        // IMPORTANT:
        // Wait until Firestore saves it
        // BEFORE opening search results.

        await saveSearch(term);


        window.location.href =
          `search-results.html?q=${encodeURIComponent(term)}`;


      } catch (error) {

        console.error(
          "Search history save error:",
          error
        );


        flash(
          "Could not save your search.",
          "error"
        );

      }

    }
  );



  // ========================================
  // CLEAR ALL RECENT SEARCHES
  // ========================================

  clearButton?.addEventListener(
    "click",
    async event => {

      event.preventDefault();


      try {

        const searchQuery =
          query(
            collection(db, "searchHistory"),
            where(
              "userId",
              "==",
              ctx.user.uid
            )
          );


        const snapshot =
          await getDocs(searchQuery);


        for (const searchDoc of snapshot.docs) {

          await deleteDoc(
            doc(
              db,
              "searchHistory",
              searchDoc.id
            )
          );

        }


        await loadRecentSearches();


      } catch (error) {

        console.error(
          "Clear search history error:",
          error
        );


        flash(
          "Could not clear search history.",
          "error"
        );

      }

    }
  );



  // ========================================
  // LOAD WHEN SEARCH PAGE OPENS
  // ========================================

  await loadRecentSearches();


  // Also refresh if browser restores this
  // page after pressing Back.

  window.addEventListener(
    "pageshow",
    async () => {

      await loadRecentSearches();

    }
  );

}
// ==========================================
// MAP / DISTANCE HELPERS
// ==========================================

function degreesToRadians(value) {

    return value * Math.PI / 180;

}


function calculateDistanceKm(
    lat1,
    lon1,
    lat2,
    lon2
) {

    const earthRadius =
        6371;


    const latitudeDifference =
        degreesToRadians(
            lat2 - lat1
        );


    const longitudeDifference =
        degreesToRadians(
            lon2 - lon1
        );


    const a =
        Math.sin(
            latitudeDifference / 2
        ) ** 2

        +

        Math.cos(
            degreesToRadians(lat1)
        )

        *

        Math.cos(
            degreesToRadians(lat2)
        )

        *

        Math.sin(
            longitudeDifference / 2
        ) ** 2;


    const c =
        2
        *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );


    return earthRadius * c;

}


function providerPriceNumber(
    value
) {

    if (
        typeof value ===
        "number"
    ) {

        return value;

    }


    const clean =
        String(
            value
            ||
            ""
        )
        .replace(
            /[^0-9.]/g,
            ""
        );


    const number =
        Number(clean);


    return Number.isFinite(number)
        ? number
        : Number.MAX_SAFE_INTEGER;

}


function providerRatingNumber(
    value
) {

    const number =
        Number(value);


    return Number.isFinite(number)
        ? number
        : 0;

}
async function handleSearchResults(ctx) {

    const list =
        document.getElementById(
            "providerResultsList"
        )
        ||
        document.querySelector(
            ".results-list"
        );


    if (!list) {
        return;
    }


    const count =
        document.querySelector(
            ".results-count"
        );


    const searchInput =
        document.querySelector(
            ".search-input-wrapper input"
        );


    const mapStatus =
        document.getElementById(
            "mapLocationStatus"
        );


    const searchTerm =
        (
            qparam("q")
            ||
            searchInput?.value
            ||
            ""
        )
        .trim();


    const term =
        searchTerm.toLowerCase();


    if (searchInput) {

        searchInput.value =
            searchTerm;

    }


    let map = null;

    let userMarker = null;

    let providerMarkerLayer = null;

    let userLatitude = null;

    let userLongitude = null;

   let currentSort = "nearest";
let matchingProviders = [];
let providersLoaded = false;
   



    // ==========================================
    // CREATE LEAFLET MAP
    // ==========================================

    if (
        window.L
        &&
        document.getElementById(
            "searchMap"
        )
    ) {


        map =
            L.map(
                "searchMap"
            ).setView(
                [
                    13.77,
                    122.98
                ],
                12
            );


        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {

                maxZoom:
                    19,

                attribution:
                    '&copy; OpenStreetMap contributors'

            }
        ).addTo(map);


        providerMarkerLayer =
            L.layerGroup()
                .addTo(map);

    }



    // ==========================================
    // RENDER PROVIDER CARDS
    // ==========================================

    function renderProviders() {


        let rows =
            [...matchingProviders];



           if (currentSort === "nearest") {
    rows.sort((a, b) => {
        const aDistance = Number.isFinite(a.distance)
            ? a.distance
            : Infinity;
        const bDistance = Number.isFinite(b.distance)
            ? b.distance
            : Infinity;

        if (aDistance !== bDistance) {
            return aDistance - bDistance;
        }

        const ratingDifference =
            providerRatingNumber(b.rating) -
            providerRatingNumber(a.rating);

        if (ratingDifference !== 0) {
            return ratingDifference;
        }

        return providerPriceNumber(a.price) -
            providerPriceNumber(b.price);
    });
}

        


        if (
            currentSort ===
            "rating"
        ) {


            rows.sort(
                (a, b) =>
                    providerRatingNumber(
                        b.rating
                    )
                    -
                    providerRatingNumber(
                        a.rating
                    )
            );

        }


        if (
            currentSort ===
            "price"
        ) {


            rows.sort(
                (a, b) =>
                    providerPriceNumber(
                        a.price
                    )
                    -
                    providerPriceNumber(
                        b.price
                    )
            );

        }



        if (count) {

            count.textContent =
                `${rows.length} result${rows.length === 1 ? "" : "s"} for "${searchTerm || "providers"}"`;

        }



        if (
            rows.length ===
            0
        ) {


            list.innerHTML = `

                <div
                    style="
                        padding:35px 20px;
                        text-align:center;
                        color:#94a3b8;
                    "
                >

                    <strong
                        style="
                            display:block;
                            color:#475467;
                            margin-bottom:6px;
                        "
                    >
                        No verified providers found
                    </strong>

                    <span
                        style="
                            font-size:12px;
                        "
                    >
                        Try another service or search term.
                    </span>

                </div>

            `;


            return;

        }



              list.innerHTML = rows.map(provider => {
          const distanceText = Number.isFinite(provider.distance)
            ? `${provider.distance.toFixed(1)} km away`
            : "Distance unavailable";

          const price = providerPriceNumber(provider.price);
          const priceText = price !== Number.MAX_SAFE_INTEGER
            ? `From ₱${price.toLocaleString()}`
            : "Contact for price";

          const rating = provider.rating || "New";

          return `
            <a class="provider-card search-result-card"
               href="service.html?provider=${encodeURIComponent(provider.id)}">
              <img class="provider-avatar"
                   src="${escapeHtml(provider.photoURL || "logo.png")}"
                   alt="">

              <div class="provider-info">
                <strong class="provider-name">
                  ${escapeHtml(provider.shopName || provider.displayName || "Provider")}
                </strong>

                <p class="provider-title">
                  ${escapeHtml(provider.displayName || "Provider")} ·
                  ${escapeHtml(provider.serviceCategory || "Repair service")}
                </p>

                <p class="result-place">
                  ⌖ <span class="result-location-name">Finding location name…</span>
                </p>

                <div class="result-rating-row">
                  <span class="result-rating">
                    ★ ${escapeHtml(String(rating))}
                    <small>
  (${provider.reviewCount || 0} ${provider.reviewCount === 1 ? "review" : "reviews"})
</small>
                  </span>
                  <span class="result-view">View Services →</span>
                </div>
              </div>

              <div class="result-card-footer">
                <span class="result-distance">${escapeHtml(distanceText)}</span>
                <span class="result-price">${escapeHtml(priceText)}</span>
              </div>
            </a>
          `;
        }).join("");

        list.querySelectorAll(".search-result-card").forEach((card, index) => {
          const locationName = card.querySelector(".result-location-name");
          if (locationName) {
            void displayServiceLocation(rows[index], [locationName]);
          }
        });
    }



    // ==========================================
    // MAP PROVIDER MARKERS
    // ==========================================

    function renderProviderMarkers() {


        if (
            !map
            ||
            !providerMarkerLayer
        ) {

            return;

        }


        providerMarkerLayer
            .clearLayers();


        const bounds =
            [];


        if (
            Number.isFinite(
                userLatitude
            )
            &&
            Number.isFinite(
                userLongitude
            )
        ) {


            if (!userMarker) {


                userMarker =
                    L.circleMarker(
                        [
                            userLatitude,
                            userLongitude
                        ],
                        {

                            radius:
                                9,

                            weight:
                                3,

                            fillOpacity:
                                1

                        }
                    )
                    .addTo(map)
                    .bindPopup(
                        "Your current location"
                    );


            } else {


                userMarker.setLatLng(
                    [
                        userLatitude,
                        userLongitude
                    ]
                );

            }


            bounds.push(
                [
                    userLatitude,
                    userLongitude
                ]
            );

        }



        matchingProviders
            .forEach(
                provider => {


                    const latitude =
                        Number(
                            provider.latitude
                        );


                    const longitude =
                        Number(
                            provider.longitude
                        );


                    if (
                        !Number.isFinite(
                            latitude
                        )
                        ||
                        !Number.isFinite(
                            longitude
                        )
                    ) {

                        return;

                    }


                    const distance =
                        Number.isFinite(
                            provider.distance
                        )
                        ?
                        `${provider.distance.toFixed(1)} km away`
                        :
                        "";


                    const marker =
                        L.marker(
                            [
                                latitude,
                                longitude
                            ]
                        )
                        .bindPopup(
                            `

                                <div
                                    style="
                                        min-width:140px;
                                    "
                                >

                                    <strong>
                                        ${escapeHtml(provider.displayName || "Provider")}
                                    </strong>

                                    <br>

                                    <span>
                                        ${escapeHtml(provider.serviceCategory || "Repair Service")}
                                    </span>

                                    <br>

                                    <span>
                                        ${escapeHtml(distance)}
                                    </span>

                                    <br>

                                    <a
                                        href="service.html?provider=${encodeURIComponent(provider.id)}"
                                        style="
                                            color:#2cb396;
                                            font-weight:600;
                                        "
                                    >
                                        View Provider
                                    </a>

                                </div>

                            `
                        );


                    marker.addTo(
                        providerMarkerLayer
                    );


                    bounds.push(
                        [
                            latitude,
                            longitude
                        ]
                    );

                }
            );



        if (
            bounds.length >
            1
        ) {


            map.fitBounds(
                bounds,
                {

                    padding:
                        [
                            35,
                            35
                        ],

                    maxZoom:
                        15

                }
            );


        } else if (
            bounds.length ===
            1
        ) {


            map.setView(
                bounds[0],
                14
            );

        }

    }



    // ==========================================
    // LOAD VERIFIED PROVIDERS
    // ==========================================
// ==========================================
// LOAD VERIFIED PROVIDERS - REAL TIME
// ==========================================

const categoryAliases = {
  "electrician": ["electrician", "electricians"],
  "ac repair": ["ac repair", "ac_repair", "aircon", "air conditioner"],
  "plumber": ["plumber", "plumbing"],
  "appliance": ["appliance", "appliances"],
  "carpenter": ["carpenter", "carpentry"],
  "auto tech": ["auto tech", "auto_tech", "auto technician", "automotive"],
  "gadget tech": ["gadget tech", "gadget_tech", "gadget technician"],
  "locksmith": ["locksmith"],
  "roofing": ["roofing", "roofer"],
  "welder": ["welder", "welding"],
  "others": ["others", "other"]
};

let providerListener = null;

providerListener = onSnapshot(
  query(
    collection(db, "users"),
    where("role", "==", "provider")
  ),

  async snapshot => {

    try {

      // Get only verified providers
      const allProviders = snapshot.docs
        .map(providerDoc => ({
          id: providerDoc.id,
          ...providerDoc.data()
        }))
        .filter(provider => provider.verified === true);


      // ==========================================
      // FILTER BY CATEGORY / SEARCH TERM
      // ==========================================

      matchingProviders = allProviders.filter(provider => {

        const category = String(
          provider.serviceCategory || ""
        )
          .trim()
          .toLowerCase();


        // CATEGORY BUTTON
        if (categoryAliases[term]) {

          return categoryAliases[term].some(alias => {
            return category === alias;
          });

        }


        // NORMAL SEARCH
        const searchableText = [
          provider.shopName,
          provider.displayName,
          provider.serviceCategory,
          ...(Array.isArray(provider.skills)
            ? provider.skills
            : [])
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();


        return !term ||
          searchableText.includes(term);

      });


      // ==========================================
      // LOAD REVIEWS / RATINGS
      // ==========================================

      await Promise.all(

        matchingProviders.map(async provider => {

          try {

            const reviewSnapshot = await getDocs(
              query(
                collection(db, "providerReviews"),
                where(
                  "providerId",
                  "==",
                  provider.id
                )
              )
            );


            const ratings = reviewSnapshot.docs
              .map(item =>
                Number(item.data().rating)
              )
              .filter(value =>
                Number.isInteger(value) &&
                value >= 1 &&
                value <= 5
              );


            provider.reviewCount =
              ratings.length;


            provider.rating =
              ratings.length
                ? ratings.reduce(
                    (sum, value) =>
                      sum + value,
                    0
                  ) / ratings.length
                : null;


          } catch (reviewError) {

            console.warn(
              "Could not load provider reviews:",
              reviewError
            );

            provider.reviewCount = 0;
            provider.rating = null;

          }

        })

      );


      // ==========================================
      // SHOW PROVIDERS
      // ==========================================

      renderProviders();

      renderProviderMarkers();


    } catch (error) {

      console.error(
        "Real-time provider search error:",
        error
      );


      list.innerHTML = `
        <p
          style="
            color:#dc3545;
            text-align:center;
            padding:25px;
          "
        >
          Could not load providers.
        </p>
      `;

    }

  },

  error => {

    console.error(
      "Real-time provider listener error:",
      error
    );


    list.innerHTML = `
      <p
        style="
          color:#dc3545;
          text-align:center;
          padding:25px;
        "
      >
        Could not load providers.
      </p>
    `;

  }

);


// Stop the Firestore listener when leaving the page
window.addEventListener(
  "pagehide",
  () => {

    if (providerListener) {
      providerListener();
      providerListener = null;
    }

  },
  { once: true }
);



    // ==========================================
    // USER CURRENT GPS
    // ==========================================

    function useCustomerLocation(
        latitude,
        longitude
    ) {


        userLatitude =
            Number(latitude);


        userLongitude =
            Number(longitude);


        matchingProviders =
            matchingProviders.map(
                provider => {


                    const providerLatitude =
                        Number(
                            provider.latitude
                        );


                    const providerLongitude =
                        Number(
                            provider.longitude
                        );


                    let distance =
                        null;


                    if (
                        Number.isFinite(
                            providerLatitude
                        )
                        &&
                        Number.isFinite(
                            providerLongitude
                        )
                    ) {


                        distance =
                            calculateDistanceKm(

                                userLatitude,
                                userLongitude,

                                providerLatitude,
                                providerLongitude

                            );

                    }


                    return {

                        ...provider,

                        distance

                    };

                }
            );


        sessionStorage.setItem(

            "reparoCustomerLocation",

            JSON.stringify(
                {

                    latitude:
                        userLatitude,

                    longitude:
                        userLongitude

                }
            )

        );


        if (mapStatus) {

            mapStatus.textContent =
                "Using your current location to find nearby verified providers.";

        }


        renderProviders();

        renderProviderMarkers();

    }



    const savedLocation =
        sessionStorage.getItem(
            "reparoCustomerLocation"
        );


    if (savedLocation) {


        try {


            const saved =
                JSON.parse(
                    savedLocation
                );


            if (
                Number.isFinite(
                    Number(
                        saved.latitude
                    )
                )
                &&
                Number.isFinite(
                    Number(
                        saved.longitude
                    )
                )
            ) {


                useCustomerLocation(
                    Number(
                        saved.latitude
                    ),
                    Number(
                        saved.longitude
                    )
                );

            }


        } catch (error) {

            console.error(
                "Saved location error:",
                error
            );

        }

    }



    if (
        navigator.geolocation
    ) {


        navigator.geolocation.getCurrentPosition(

            position => {


                useCustomerLocation(

                    position.coords.latitude,

                    position.coords.longitude

                );

            },


            error => {


                console.warn(
                    "Customer location unavailable:",
                    error
                );


                if (mapStatus) {

                    mapStatus.textContent =
                        "Location permission is off. Provider results are still available, but Nearest sorting needs your location.";

                }


                renderProviderMarkers();

            },


            {

                enableHighAccuracy:
                    true,

                timeout:
                    15000,

                maximumAge:
                    60000

            }

        );


    } else {


        if (mapStatus) {

            mapStatus.textContent =
                "Your browser does not support location detection.";

        }

    }



    // ==========================================
    // SORT BUTTONS
    // ==========================================

    document
        .querySelectorAll(
            ".sort-chip[data-sort]"
        )
        .forEach(
            button => {


                button.addEventListener(
                    "click",
                    () => {


                        const sort =
                            button.dataset.sort;


                        if (
                            sort ===
                            "nearest"
                            &&
                            (
                                !Number.isFinite(
                                    userLatitude
                                )
                                ||
                                !Number.isFinite(
                                    userLongitude
                                )
                            )
                        ) {


                            flash(
                                "Allow location access to sort providers by nearest.",
                                "error"
                            );


                            return;

                        }


                        currentSort =
                            sort;


                        document
                            .querySelectorAll(
                                ".sort-chip[data-sort]"
                            )
                            .forEach(
                                chip => {

                                    const active =
                                        chip ===
                                        button;


                                    chip.classList.toggle(
                                        "chip-active",
                                        active
                                    );


                                    chip.classList.toggle(
                                        "chip-inactive",
                                        !active
                                    );

                                }
                            );


                        renderProviders();

                    }
                );

            }
        );



    // ==========================================
    // REMEMBER SELECTED PROVIDER
    // ==========================================

    list.addEventListener(
        "click",
        event => {


            const providerCard =
                event.target.closest(
                    "[data-provider-id]"
                );


            if (providerCard) {


                sessionStorage.setItem(

                    "reparoSelectedProviderId",

                    providerCard.dataset.providerId

                );

            }

        }
    );


    renderProviderMarkers();

}const profileAddressRequests = new Map();
const profileAddressVersions = new WeakMap();

let profileAddressQueue = Promise.resolve();
let profileAddressLastRequest = 0;

async function displayServiceLocation(
  profile,
  targets = [document.getElementById("providerLocation")]
) {
  const elements = [...targets].filter(Boolean);
  if (!elements.length) return;

  const token = {};

  elements.forEach(element => {
    profileAddressVersions.set(element, token);
  });

  function show(value) {
    elements.forEach(element => {
      if (
        element.isConnected &&
        profileAddressVersions.get(element) === token
      ) {
        element.textContent = value;
      }
    });
  }

  const saved =
    typeof profile.location === "string"
      ? profile.location.trim()
      : "";

  const coordinateMatch = saved.match(
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
  );

  if (saved && !coordinateMatch) {
    show(saved);
    return;
  }

  const numeric = value => (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) ? NaN : Number(value);

  const latitude = numeric(
    coordinateMatch
      ? coordinateMatch[1]
      : profile.latitude
  );

  const longitude = numeric(
    coordinateMatch
      ? coordinateMatch[2]
      : profile.longitude
  );

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    show("Location not provided");
    return;
  }
// Remove the repeated credits beside each location.
document
  .querySelectorAll("[data-address-credit]")
  .forEach(element => element.remove());

if (!document.getElementById("locationSourceCredit")) {
  const credit = document.createElement("p");
  credit.id = "locationSourceCredit";

  const link = document.createElement("a");
  link.href = "https://www.openstreetmap.org/copyright";
  link.textContent = "Location data © OpenStreetMap";

  credit.append(link);

  const host =
    document.querySelector(".service-profile") ||
    document.querySelector(".profile-app main") ||
    document.querySelector(".mobile-wrapper main");

  host?.append(credit);
}

  const key =
    `reparo-address:${latitude.toFixed(6)},` +
    longitude.toFixed(6);

  try {
    const cached = localStorage.getItem(key);

    if (cached) {
      show(cached);
      return;
    }
  } catch {
    // Continue if browser storage is unavailable.
  }

  show("Finding location name…");

  if (!profileAddressRequests.has(key)) {
    const request = profileAddressQueue.then(async () => {
      const delay = Math.max(
        0,
        1100 - (Date.now() - profileAddressLastRequest)
      );

      if (delay) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      profileAddressLastRequest = Date.now();

      const url = new URL(
        "https://nominatim.openstreetmap.org/reverse"
      );

      url.search = new URLSearchParams({
        format: "jsonv2",
        lat: String(latitude),
        lon: String(longitude),
        zoom: "16",
        addressdetails: "1",
        "accept-language": "en"
      });

      const response = await fetch(url, {
        signal: AbortSignal.timeout(12000)
      });

      if (!response.ok) {
        throw new Error("Location lookup failed.");
      }

      const result = await response.json();
      const address = result.address || {};

      const parts = [
        address.suburb ||
          address.quarter ||
          address.neighbourhood ||
          address.village,

        address.city ||
          address.town ||
          address.municipality,

        address.province ||
          address.state_district ||
          address.state
      ].filter(Boolean);

      const name =
        [...new Set(parts)].join(", ") ||
        result.display_name;

      if (!name) {
        throw new Error("No location name returned.");
      }

      try {
        localStorage.setItem(key, name);
      } catch {
        // Caching is optional.
      }

      return name;
    });

    profileAddressRequests.set(key, request);
    profileAddressQueue = request.catch(() => {});
  }

  try {
    show(await profileAddressRequests.get(key));
  } catch (error) {
    console.warn("Profile location:", error);
    show("Location name unavailable");
  } finally {
    profileAddressRequests.delete(key);
  }

}function setupServicePresentation(ctx, providerId) {
  const params = new URLSearchParams(location.search);

  const isOwnProfile =
    ctx.user.uid === providerId;

  const returningToProvider =
  isOwnProfile ||
  params.get("back") === "provider-profile";

  const back = document.getElementById("serviceBackButton");
if (back) {
  let destination = returningToProvider
    ? "rm-profile.html"
    : "search.html";

  if (!returningToProvider) {
    const returnTo = params.get("returnTo");

    if (returnTo) {
      const resultPage = new URL(returnTo, location.href);

      if (
        resultPage.origin === location.origin &&
       ["search-results.html", "index.html"].includes(
  resultPage.pathname.split("/").pop()
)
      ) {
        destination = resultPage.pathname + resultPage.search;
      }
    } else if (document.referrer) {
      const previousPage = new URL(document.referrer);

      if (
        previousPage.origin === location.origin &&
        ["search-results.html", "index.html"].includes(
  previousPage.pathname.split("/").pop()
)
      ) {
        destination = previousPage.pathname + previousPage.search;
      }
    }
  }

  back.href = destination;
  back.setAttribute(
    "aria-label",
    destination.includes("search-results.html")
      ? "Back to search results"
      : returningToProvider
        ? "Back to my provider profile"
        : "Back to search"
  );


  back.href = destination;
  back.setAttribute(
    "aria-label",
    destination.includes("search-results.html")
      ? "Back to provider results"
      : returningToProvider
        ? "Back to my provider profile"
        : "Back to search"
  );
}

  function pointFrom(profile = {}) {
    function numeric(value) {
      return value === null ||
        value === undefined ||
        String(value).trim() === ""
          ? NaN
          : Number(value);
    }

    let latitude = numeric(profile.latitude);
    let longitude = numeric(profile.longitude);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      const match =
        typeof profile.location === "string"
          ? profile.location.match(
              /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
            )
          : null;

      if (match) {
        latitude = Number(match[1]);
        longitude = Number(match[2]);
      }
    }

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return null;
    }

    return { latitude, longitude };
  }

  function distanceKm(first, second) {
    const radians = degrees => degrees * Math.PI / 180;

    const latitudeDifference = radians(
      second.latitude - first.latitude
    );

    const longitudeDifference = radians(
      second.longitude - first.longitude
    );

    const value =
      Math.sin(latitudeDifference / 2) ** 2 +
      Math.cos(radians(first.latitude)) *
      Math.cos(radians(second.latitude)) *
      Math.sin(longitudeDifference / 2) ** 2;

    const clamped = Math.min(1, Math.max(0, value));

    return 6371 * 2 * Math.atan2(
      Math.sqrt(clamped),
      Math.sqrt(1 - clamped)
    );
  }

 const locationElement =
  document.getElementById("providerLocation");

if (!locationElement) {
  console.error("Service header is missing #providerLocation.");
  return () => {};
}

  let distanceBox =
    document.getElementById("providerDistanceBox");

  if (!distanceBox) {
    distanceBox = document.createElement("div");
    distanceBox.id = "providerDistanceBox";

    const text = document.createElement("p");
    text.id = "providerDistance";
    text.setAttribute("role", "status");

    const button = document.createElement("button");
    button.id = "serviceDistanceLocation";
    button.type = "button";
    button.textContent = "Use my current location";
    button.hidden = true;
button.style.setProperty("display", "none", "important");

  distanceBox.append(text, button);
locationElement.closest(".hero-location").after(distanceBox);
  }

  const distanceText =
    document.getElementById("providerDistance");

  const locationButton =
    document.getElementById("serviceDistanceLocation");

  // An owner's preview cannot know another customer's location.
  distanceBox.hidden = isOwnProfile;

  let customerPoint = pointFrom(ctx.profile);
  let providerPoint = null;
  let usingCurrentLocation = false;
  let detecting = false;

  function renderDistance() {
    if (isOwnProfile) return;

    locationButton.hidden = !providerPoint;

    if (!providerPoint) {
      distanceText.textContent =
        "Distance unavailable — provider map location is not saved.";
      return;
    }

    if (!customerPoint) {
      distanceText.textContent =
        "Use your location to see the approximate distance.";
      return;
    }

    const kilometres = distanceKm(
      customerPoint,
      providerPoint
    );

    const amount = kilometres < 0.1
      ? "Less than 0.1 km"
      : `${kilometres.toFixed(1)} km`;

    distanceText.textContent =
      `${amount} from your ${
        usingCurrentLocation ? "current" : "saved"
      } location`;
  }

  locationButton.addEventListener("click", async () => {
    if (detecting) return;

    if (!navigator.geolocation) {
      distanceText.textContent =
        "Your browser does not support location detection.";
      return;
    }

    detecting = true;
    locationButton.disabled = true;
    distanceText.textContent = "Finding your location…";

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 60000
          }
        );
      });

      customerPoint = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };

      usingCurrentLocation = true;
      renderDistance();
    } catch {
      renderDistance();

      distanceText.textContent += customerPoint
        ? " Current location could not be retrieved."
        : " Allow location access and try again.";
    } finally {
      detecting = false;
      locationButton.disabled = false;
    }
  });

  return provider => {
    providerPoint = pointFrom(provider);
    renderDistance();
  };
}function watchServiceProfileDetails(ctx, providerId) {
  const element = id => document.getElementById(id);

  function put(id, value) {
    const target = element(id);
    if (target) target.textContent = String(value);
  }

  const stops = [];
  const observers = [];
  let liveCompleted = null;
  let savedCompleted = null;
  let reviewedCompleted = null;

  function renderCompleted() {
    const knownCounts = [
      liveCompleted,
      savedCompleted,
      reviewedCompleted
    ].filter(value => Number.isInteger(value) && value >= 0);

    const count = knownCounts.length
      ? Math.max(...knownCounts)
      : "—";

    put("providerCompleted", count);
    put("aboutCompleted", count);
  }

  function mirror(sourceId, targetId) {
    const source = element(sourceId);
    const target = element(targetId);
    if (!source || !target) return;

    const update = () => {
      target.textContent = source.textContent.trim() || "Not provided";
    };

    update();

    const observer = new MutationObserver(update);
    observer.observe(source, {
      childList: true,
      characterData: true,
      subtree: true
    });

    observers.push(observer);
  }

  mirror("providerCategory", "aboutServiceType");
  mirror("providerLocation", "aboutServiceLocation");
  mirror("providerAvailability", "aboutAvailability");
  mirror("providerPrice", "aboutPrice");

  // Only the provider can read all of their own bookings.
stops.push(
  onSnapshot(
    doc(db, "users", providerId),
    snapshot => {
      if (!snapshot.exists()) return;

      const profile = snapshot.data();
      const rawCount = profile.completedJobs;

      savedCompleted =
        rawCount !== null &&
        rawCount !== undefined &&
        String(rawCount).trim() !== "" &&
        Number.isInteger(Number(rawCount)) &&
        Number(rawCount) >= 0
          ? Number(rawCount)
          : null;

      renderCompleted();

      put(
        "heroAvailability",
        profile.available === true
          ? "Available"
          : profile.available === false
            ? "Unavailable"
            : "Check availability"
      );

      const verification = element("aboutVerified");
      if (verification) {
        verification.hidden = profile.verified !== true;
      }
    },
    error => {
      console.error("Service details:", error);
    }
  )
);

// Only the provider can read all of their own bookings.
if (ctx.user.uid === providerId) {
  stops.push(
    onSnapshot(
      query(
        collection(db, "bookings"),
        where("providerId", "==", providerId)
      ),
      snapshot => {
        liveCompleted = snapshot.docs.filter(
          item => item.data().status === "completed"
        ).length;
        renderCompleted();
      },
      error => {
        console.error("Completed booking count:", error);
        liveCompleted = null;
        renderCompleted();
      }
    )
  );
}


  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = String(text);
    return item;
  }

  function stars(rating) {
    const value = Math.max(0, Math.min(5, Math.round(rating)));
    const item = node(
      "div",
      "review-stars",
      "★".repeat(value) + "☆".repeat(5 - value)
    );

    item.setAttribute("aria-label", `${rating.toFixed(1)} out of 5`);
    return item;
  }

  function renderReviews(reviews) {
    const host = element("providerReviewSection");
    if (!host) return;

    host.replaceChildren();

    const total = reviews.length;
    reviewedCompleted = total;
    renderCompleted();

    const average = total
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / total
      : 0;

    put("providerRating", total ? average.toFixed(1) : "—");
    put("providerReviews", total);
    put("heroRatingValue", total ? average.toFixed(1) : "No ratings");
    put("heroReviewCount", `(${total})`);

    const overview = node("div", "review-overview");
    const score = node("div", "review-score");

    score.append(
      node("strong", "", total ? average.toFixed(1) : "—"),
      stars(average),
      node("small", "", `${total} ${total === 1 ? "review" : "reviews"}`)
    );

    const distribution = node("div", "review-distribution");

    for (let rating = 5; rating >= 1; rating--) {
      const count = reviews.filter(review => review.rating === rating).length;
      const row = node("div", "review-bar-row");
      const progress = document.createElement("progress");

      progress.max = total || 1;
      progress.value = count;
      progress.setAttribute(
        "aria-label",
        `${rating} stars: ${count} reviews`
      );

      row.append(node("span", "", rating), progress);
      distribution.append(row);
    }

    overview.append(score, distribution);
    host.append(overview);

    if (!total) {
      host.append(
        node("p", "customer-review", "No customer reviews yet.")
      );
      return;
    }

    for (const review of reviews) {
      const card = node("article", "customer-review");
      const header = node("div", "customer-review-header");

      const name =
        typeof review.customerName === "string" &&
        review.customerName.trim()
          ? review.customerName.trim()
          : "Customer";

      const avatar = node(
        "span",
        "review-avatar",
        name.charAt(0).toUpperCase()
      );
      avatar.setAttribute("aria-hidden", "true");

      const author = node("div", "review-author");
      author.append(node("strong", "", name), stars(review.rating));
      header.append(avatar, author);

      const date = review.createdAt?.toDate?.();

      if (date && Number.isFinite(date.getTime())) {
        const time = node(
          "time",
          "",
          date.toLocaleDateString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric"
          })
        );
        time.dateTime = date.toISOString();
        header.append(time);
      }

      card.append(header);

      if (typeof review.comment === "string" && review.comment.trim()) {
        card.append(node("p", "", review.comment.trim()));
      }

      host.append(card);
    }
  }

  stops.push(
    onSnapshot(
      query(
        collection(db, "providerReviews"),
        where("providerId", "==", providerId)
      ),
      snapshot => {
        const reviews = snapshot.docs
          .map(item => item.data())
          .map(review => ({
            ...review,
            rating: Number(review.rating)
          }))
          .filter(review =>
            Number.isInteger(review.rating) &&
            review.rating >= 1 &&
            review.rating <= 5
          )
          .sort((a, b) =>
            (b.createdAt?.seconds || 0) -
            (a.createdAt?.seconds || 0)
          );

        renderReviews(reviews);
      },
      error => {
        console.error("Provider reviews:", error);

        const host = element("providerReviewSection");
        if (host) {
          host.replaceChildren(
            node("p", "customer-review", "Unable to load reviews. Please reload.")
          );
        }

        put("providerRating", "—");
        put("providerReviews", "—");
      }
    )
  );

  window.addEventListener("pagehide", () => {
    stops.forEach(stop => stop());
    observers.forEach(observer => observer.disconnect());
  }, { once: true });
}async function handleServiceDetails(ctx) {
    // Use only the provider selected in this page's URL.
    const id = new URLSearchParams(location.search).get("provider");

    const details = document.getElementById("providerDetails");
    const status = document.getElementById("providerLoadStatus");

    if (!details || !status) return;

    function showError(text) {
        details.hidden = true;
        status.hidden = false;
        status.textContent = text;
    }

    if (!id) {
        showError("Please select a provider from Search.");
        return;
    }

    function setText(elementId, value) {
        document.getElementById(elementId).textContent = value;
    }

    function safeImageURL(value) {
        if (typeof value !== "string" || !value.trim()) return "";

        try {
            const url = new URL(value);
            return url.protocol === "https:" ? url.href : "";
        } catch {
            return "";
        }
    }

    function savedNumber(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : null;
    }

    function emptyNote(container, text) {
        const note = document.createElement("p");
        note.textContent = text;
        container.append(note);
    }
const updateServicePresentation =
  setupServicePresentation(ctx, id);
  watchServiceProfileDetails(ctx, id);
    const stopProvider = onSnapshot(
        doc(db, "users", id),
        snapshot => {
            if (!snapshot.exists()) {
                showError("This provider profile could not be found.");
                return;
            }

            const provider = snapshot.data();
            updateServicePresentation(provider);

            if (provider.role !== "provider") {
                showError("This account is not a service provider.");
                return;
    }

           const name = [
  provider.displayName,
  provider.fullName
].find(value =>
  typeof value === "string" && value.trim()
)?.trim() || "Name not provided";

setText("providerName", name);

const shopElement = document.getElementById("providerShopName");

if (shopElement) {
  const shopName = String(provider.shopName || "").trim();
  shopElement.textContent = shopName;
  shopElement.hidden = !shopName;
}
setText(
  "providerCategory",
  String(provider.serviceCategory || "Repair service")
    .replace(/_/g, " ")
);
           void displayServiceLocation(provider);
            setText(
                "providerBio",
                provider.bio || "No description provided yet."
            );

            // Do not assume that a missing price means free service.
            const rawPrice = provider.price;
            const price = savedNumber(rawPrice);

            setText(
                "providerPrice",
                price !== null
                    ? new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP"
                    }).format(price)
                    : typeof rawPrice === "string" && rawPrice.trim()
                        ? rawPrice
                        : "Price not provided"
            );

            const availability = provider.availability;
            setText(
                "providerAvailability",
                typeof availability === "string" && availability.trim()
                    ? availability
                    : typeof provider.available === "boolean"
                        ? provider.available
                            ? "Available"
                            : "Currently unavailable"
                        : "Availability not provided"
            );

            document.getElementById("providerVerified").hidden =
                provider.verified !== true;

            const photo = document.getElementById("providerPhoto");
            const fallback =
                document.getElementById("providerAvatarFallback");
            const photoURL = safeImageURL(provider.photoURL);

            photo.hidden = true;
            fallback.hidden = false;

            photo.onload = () => {
                photo.hidden = false;
                fallback.hidden = true;
            };

            photo.onerror = () => {
                photo.hidden = true;
                fallback.hidden = false;
            };

            photo.alt = name;

            if (photoURL) {
                photo.src = photoURL;
            } else {
                photo.removeAttribute("src");
            }

          
            const skillsHost = document.getElementById("providerSkills");
            skillsHost.replaceChildren();

            const skills = Array.isArray(provider.skills)
                ? provider.skills.filter(
                    skill => typeof skill === "string" && skill.trim()
                )
                : [];

            skills.forEach(skill => {
                const chip = document.createElement("span");
                chip.textContent = skill;
                skillsHost.append(chip);
            });

            if (!skills.length) {
                emptyNote(skillsHost, "No skills listed yet.");
            }

            const photosHost =
                document.getElementById("providerWorkPhotos");
            photosHost.replaceChildren();

            const workPhotos = Array.isArray(provider.workPhotos)
                ? provider.workPhotos
                    .map(safeImageURL)
                    .filter(Boolean)
                : [];

            workPhotos.forEach((url, index) => {
                const image = document.createElement("img");
                image.src = url;
                image.alt = `${name} — work photo ${index + 1}`;
                image.loading = "lazy";
                photosHost.append(image);
            });

            if (!workPhotos.length) {
                emptyNote(photosHost, "No work photos uploaded yet.");
            }

          const contact = document.getElementById("providerContact");
const contactNote = document.getElementById("providerContactNote");

contact.href =
  `chat.html?with=${encodeURIComponent(id)}&from=customer&back=profile`;
contact.removeAttribute("aria-disabled");
contact.setAttribute("aria-label", `Contact ${name}`);
contact.title = `Chat with ${name}`;

if (contactNote) {
  contactNote.hidden = true;
  contactNote.textContent = "";
}

            document.getElementById("providerBook").href =
                `book-repair.html?provider=${encodeURIComponent(id)}`;

            status.hidden = true;
            details.hidden = false;
        },
            error => {
            console.error("Provider profile:", error);

            showError(
                error.code === "permission-denied"
                    ? "You do not have permission to view this provider."
                    : "Could not load this provider. Please refresh to retry."
            );
        }
    );

    window.addEventListener("pagehide", stopProvider, { once: true });
}


    
async function handleNotifications(ctx) {
  const host = document.querySelector(".notifications-list");
  if (!host) return;

  const isAdmin = ctx.profile.role === "admin";
  const markAll = document.querySelector(".mark-read-btn");
  const back = document.querySelector(".back-btn");
  const chips = document.querySelector(".filter-chips");

  let rows = [];
  let selectedFilter = "all";

  if (back) {
    back.href = isAdmin
      ? "admin-index.html"
      : ctx.profile.role === "provider"
        ? "rm-index.html"
        : "index.html";
  }

  // Admin alerts represent applications awaiting a decision.
  // Opening an alert does not remove it from the pending queue.
  if (markAll) markAll.hidden = isAdmin;

  const paths = {
    application:
      "M12 2L3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4zm-1 14l-4-4 1.4-1.4 2.6 2.6 5.6-5.6L18 9l-7 7z",
    booking:
      "M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z",
    message:
      "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM4 17.2V4h16v12H5.2L4 17.2z",
    clock:
      "M12 2a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16zm1-13h-2v6l5 3 1-1.7-4-2.3V7z"
  };

  function category(item) {
    const type = String(item.type || "").toLowerCase();

    if (/application|provider/.test(type)) return "applications";
    if (/book/.test(type)) return "bookings";
    if (/message|chat/.test(type)) return "messages";

    return "other";
  }

  function svg(path) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="${path}"></path>
    </svg>`;
  }

  function formattedDate(value) {
    const date = value?.toDate
      ? value.toDate()
      : value
        ? new Date(value)
        : null;

    if (!date || Number.isNaN(date.getTime())) return "Just now";

    return date.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  // Notification details window.
  const dialog = document.createElement("dialog");
  dialog.className = "notification-dialog";

  dialog.innerHTML = `
    <div class="notification-detail-heading">
      <h2>Notification</h2>
      <button type="button" class="notification-close"
        aria-label="Close notification">×</button>
    </div>
    <p class="notification-detail-message"></p>
    <p class="notification-detail-time"></p>
    <div class="notification-actions">
  <a class="notification-action" hidden></a>
  <a class="notification-message-admin" hidden>Message Admin</a>
</div>
</div>
  `;
// Second action for declined permit notifications.
const actionsRow = document.createElement("div");
actionsRow.className = "notification-actions";

const uploadButton = dialog.querySelector(".notification-action");
actionsRow.appendChild(uploadButton);

const messageAdminButton = document.createElement("a");
messageAdminButton.className = "notification-message-admin";
messageAdminButton.textContent = "Message Admin";
messageAdminButton.hidden = true;
actionsRow.appendChild(messageAdminButton);

dialog.appendChild(actionsRow);
  document.body.appendChild(dialog);

  dialog.querySelector(".notification-close")
    .addEventListener("click", () => dialog.close());

  dialog.addEventListener("click", event => {
    const bounds = dialog.getBoundingClientRect();

    if (
      event.target === dialog &&
      (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
    ) {
      dialog.close();
    }
});
async function openNotification(item) {
  
  
  dialog.querySelector("h2").textContent =
    item.title || "Notification";

  dialog.querySelector(".notification-detail-message")
    .textContent = item.message || "";

  dialog.querySelector(".notification-detail-time")
    .textContent = formattedDate(item.createdAt);

 const action = dialog.querySelector(".notification-action");
const messageAdmin = dialog.querySelector(".notification-message-admin");

// Paste the admin's Firebase Authentication UID here.
// This allows OLD notifications, which have no adminId, to work too.
const SUPPORT_ADMIN_UID = "PASTE_ADMIN_UID_HERE";

let destination = "";
let label = "";

const isProvider = ctx.profile.role === "provider";
const renewalReminder =
  isProvider && item.type === "provider_permit_renewal";

const declinedRenewal =
  isProvider &&
  item.type === "provider_permit_renewal_result" &&
  /declined/i.test(item.title || "");

if (renewalReminder || declinedRenewal) {
  destination = "rm-permit-renewal.html";
  label = "Upload renewed permit";
} else if (isAdmin) {
  destination =
    "view-permit.html?application=" +
    encodeURIComponent(item.id);
  label = "Review application";
} else if (item.link === "rm-index.html") {
  destination = "rm-index.html";
  label = "Open provider dashboard";
} else if (category(item) === "bookings") {
  destination = isProvider
    ? "rm-booking.html"
    : "mybooking.html";
  label = "View bookings";
} else if (category(item) === "messages") {
  destination = item.senderId
    ? `chat.html?with=${encodeURIComponent(item.senderId)}`
    : "message.html";
  label = "Open conversation";
}

action.hidden = !destination;
if (destination) {
  action.href = destination;
  action.textContent = label;
} else {
  action.removeAttribute("href");
}

// Show Message Admin only for the provider's declined permit.
messageAdmin.hidden = true;
messageAdmin.removeAttribute("href");

if (declinedRenewal) {
  const adminUid =
    item.adminId ||
    (SUPPORT_ADMIN_UID !== "PASTE_ADMIN_UID_HERE"
      ? SUPPORT_ADMIN_UID
      : "");

  if (adminUid) {
    const params = new URLSearchParams({
      with: adminUid,
      from: "provider",
      back: "messages"
    });

    messageAdmin.href = `chat.html?${params.toString()}`;
    messageAdmin.hidden = false;
  }
}
// This UID belongs to your REPARO admin account.
const supportAdminUid = "KKutxcZ55YSls3WKMuvfgvMZjKA3";

const declinedPermit =
  !isAdmin &&
  ctx.profile.role === "provider" &&
  item.type === "provider_permit_renewal_result" &&
  /declined/i.test(item.title || "");

messageAdminButton.hidden = !declinedPermit;

if (declinedPermit) {
  const params = new URLSearchParams({
    with: item.adminId || supportAdminUid,
    from: "provider",
    back: "messages"
  });

  messageAdminButton.href = `chat.html?${params.toString()}`;
} else {
  messageAdminButton.removeAttribute("href");
}
dialog.showModal();

  if (!isAdmin && !item.read) {
    try {
      await updateDoc(doc(db, "notifications", item.id), {
        read: true
      });
    } catch (error) {
      console.error(error);
      flash(
        "Could not mark this notification as read.",
        "error"
      );
    }
  }
}
  function render() {
    const subtitle = document.querySelector(".subtitle");

    if (subtitle) {
      subtitle.textContent = isAdmin
        ? `${rows.length} pending application alerts`
        : `${rows.filter(item => !item.read).length} unread updates`;
    }

    const visible = rows.filter(item =>
      selectedFilter === "all" ||
      category(item) === selectedFilter
    );

    host.replaceChildren();

    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "notification-empty";
      empty.textContent = "No notifications here yet.";
      host.appendChild(empty);
      return;
    }

    visible.forEach(item => {
      const group = category(item);
      const iconPath = group === "bookings"
        ? paths.booking
        : group === "messages"
          ? paths.message
          : paths.application;

      const iconColor = group === "messages"
        ? "icon-amber"
        : group === "bookings"
          ? "icon-blue"
          : "icon-teal";

      const card = document.createElement("article");
      card.className =
        `notification-card ${item.read ? "" : "unread"}`;

      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute(
        "aria-label",
        `Open ${item.title || "notification"}`
      );

      // Only static icon markup is inserted as HTML.
      card.innerHTML = `
        <div class="icon-box ${iconColor}">
          ${svg(iconPath)}
        </div>
        <div class="notification-content">
          <div class="notification-header">
            <h2></h2>
            ${item.read ? "" : '<span class="unread-dot"></span>'}
          </div>
          <p class="message"></p>
          <div class="time-stamp">
            ${svg(paths.clock)}
            <span></span>
          </div>
        </div>
      `;

      card.querySelector("h2").textContent = item.title || "Update";
      card.querySelector(".message").textContent = item.message || "";
      card.querySelector(".time-stamp span").textContent =
        formattedDate(item.createdAt);

      card.addEventListener("click", () => openNotification(item));

      card.addEventListener("keydown", event => {
        if (["Enter", " "].includes(event.key)) {
          event.preventDefault();
          openNotification(item);
        }
      });

      host.appendChild(card);
    });
  }

  // Preserve your chip design and add Applications.
  if (chips) {
    chips.replaceChildren();

    const filters = isAdmin
      ? ["all", "applications"]
      : ["all", "applications", "bookings", "messages"];

    filters.forEach(filter => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chip ${filter === "all" ? "active" : ""}`;
      button.textContent = filter[0].toUpperCase() + filter.slice(1);

      button.addEventListener("click", () => {
        selectedFilter = filter;

        chips.querySelectorAll(".chip").forEach(chip => {
          chip.classList.toggle("active", chip === button);
        });

        render();
      });

      chips.appendChild(button);
    });
  }

  host.textContent = "Loading notifications…";

  const source = isAdmin
    ? query(
        collection(db, "providerApplications"),
        where("status", "==", "pending")
      )
    : query(
        collection(db, "notifications"),
        where("userId", "==", ctx.user.uid)
      );

  const stop = onSnapshot(
    source,
    snapshot => {
      rows = snapshot.docs.map(document => {
        const data = document.data();

        if (isAdmin) {
          return {
            id: document.id,
            type: "provider_application",
            title: "New Provider Application",
            message:
              `${data.fullName || data.email || "A provider"} ` +
              "submitted an application." +
              (data.serviceCategory
                ? ` Service: ${data.serviceCategory}.`
                : "") +
              (data.location ? ` Location: ${data.location}.` : ""),
            createdAt: data.submittedAt,
            read: false
          };
        }

        return { ...data, id: document.id };
      });

      rows.sort((a, b) =>
        (b.createdAt?.seconds || 0) -
        (a.createdAt?.seconds || 0)
      );

      render();
    },
    error => {
      console.error(error);
      host.textContent =
        "Unable to load notifications. Please refresh.";
    }
  );

  if (markAll && !isAdmin) {
    markAll.addEventListener("click", async () => {
      markAll.disabled = true;

      try {
        const unread = rows.filter(item => !item.read);

        for (let index = 0; index < unread.length; index += 400) {
          const batch = writeBatch(db);

          unread.slice(index, index + 400).forEach(item => {
            batch.update(doc(db, "notifications", item.id), {
              read: true
            });
          });

          await batch.commit();
        }
      } catch (error) {
        console.error(error);
        flash("Could not mark notifications as read.", "error");
      } finally {
        markAll.disabled = false;
      }
    });
  }

  window.addEventListener("pagehide", () => {
    stop();
    dialog.remove();
  }, { once: true });

}

async function handleRating(ctx) {
  const stars=[...document.querySelectorAll(".star-rating [data-value]")]; const chips=[...document.querySelectorAll(".chip-btn")]; const feedback=document.getElementById("feedbackText"); const count=document.getElementById("charCount"); let rating=0;
  stars.forEach(s=>s.addEventListener("click",()=>{rating=Number(s.dataset.value); stars.forEach(x=>x.classList.toggle("active",Number(x.dataset.value)<=rating));}));
  chips.forEach(c=>c.addEventListener("click",()=>c.classList.toggle("active")));
  feedback?.addEventListener("input",()=>{if(count)count.textContent=`${feedback.value.length}/500`;});
  document.querySelector(".submit-btn")?.addEventListener("click",async()=>{if(!rating)return flash("Tap a star before submitting.","error");try{await addDoc(collection(db,"feedback"),{userId:ctx.user.uid,rating,tags:chips.filter(c=>c.classList.contains("active")).map(c=>c.textContent.trim()),comment:feedback?.value.trim()||"",createdAt:serverTimestamp()});flash("Thank you for your feedback!");}catch(e){flash(e.message,"error");}});
}async function handleAdminDashboard() {
  const state = {
    users: null,
    providerApplications: null,
    bookings: null,
    activityLogs: null
  };

  const errors = new Set();
  const stops = [];

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  function timestamp(value) {
    if (value?.toMillis) return value.toMillis();
    const result = value ? new Date(value).getTime() : 0;
    return Number.isFinite(result) ? result : 0;
  }

  function dayKey(value) {
    if (!value) return "";

    if (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(value)
    ) {
      return value.slice(0, 10);
    }

    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(date).map(part => [part.type, part.value])
    );

    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  // Reuse the short IDs previously saved in this browser.
  let savedIds = [];

  try {
    const saved = JSON.parse(
      localStorage.getItem("reparo-admin-display-ids") || "[]"
    );

    if (Array.isArray(saved)) {
      savedIds = saved.filter(entry =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        Number.isInteger(entry[1]) &&
        entry[1] >= 101
      );
    }
  } catch (error) {
    console.warn(error);
  }

  const ids = new Map(savedIds);

  function shortId(uid) {
    if (!uid) return "Unknown";

    if (!ids.has(uid)) {
      let next = 101;
      ids.forEach(value => next = Math.max(next, value + 1));
      ids.set(uid, next);

      try {
        localStorage.setItem(
          "reparo-admin-display-ids",
          JSON.stringify([...ids])
        );
      } catch (error) {
        console.warn(error);
      }
    }

    return String(ids.get(uid));
  }

  function icon(path, color = "#33AF9C") {
    const svg = document.createElementNS(
      "http://www.w3.org/2000/svg", "svg"
    );
    svg.setAttribute("viewBox", "0 0 24 24");

    const shape = document.createElementNS(
      "http://www.w3.org/2000/svg", "path"
    );
    shape.setAttribute("d", path);
    shape.setAttribute("fill", "none");
    shape.setAttribute("stroke", color);
    shape.setAttribute("stroke-width", "2");
    shape.setAttribute("stroke-linecap", "round");
    shape.setAttribute("stroke-linejoin", "round");

    svg.appendChild(shape);
    return svg;
  }

  function activityIcon(action) {
    const value = String(action || "").toLowerCase();

    if (/declin|reject|cancel|delet/.test(value)) {
      return icon("M6 6l12 12M18 6L6 18", "#DC2626");
    }
    if (/approv|accept|complet/.test(value)) {
      return icon("M5 12l4 4L19 6");
    }
    if (/log|sign/.test(value)) {
      return icon("M14 4h6v16h-6M3 12h12M11 8l4 4-4 4");
    }
    if (/book|schedul/.test(value)) {
      return icon("M4 5h16v15H4V5M4 10h16M8 3v4M16 3v4");
    }
    if (/message|chat|comment/.test(value)) {
      return icon("M3 4h18v13H8l-5 4V4M7 9h10M7 13h6");
    }
    if (/edit|updat/.test(value)) {
      return icon("M4 16L15 5l4 4L8 20H4v-4M13 7l4 4");
    }

    return icon(
      "M6 2h8l4 4v16H6V2M14 2v5h4M9 12h6M9 16h6",
      "#D97706"
    );
  }

  function renderList(id, source, records, createRow, emptyText) {
    const host = document.getElementById(id);
    if (!host) return;

    host.replaceChildren();

    if (errors.has(source)) {
      host.textContent = "Unable to load records. Please refresh.";
    } else if (state[source] === null) {
      host.textContent = "Connecting to Firestore…";
    } else if (!records.length) {
      host.textContent = emptyText;
    } else {
      records.slice(0, 4).forEach(record => {
        host.appendChild(createRow(record));
      });
    }
  }

  function render() {
    const now = new Date();
    const today = dayKey(now);
    const deadline = dayKey(
      new Date(now.getTime() + 30 * 86400000)
    );

    const users = state.users || [];
    const userMap = new Map(users.map(user => [user.id, user]));

    const providers = users.filter(user =>
      user.role === "provider" &&
      user.disabled !== true &&
      !["disabled", "suspended", "inactive"].includes(user.status)
    );

    const customers = users.filter(user =>
      ["user", "customer"].includes(user.role)
    );

    const pending = (state.providerApplications || [])
      .filter(application => application.status === "pending")
      .sort((a, b) =>
        timestamp(b.submittedAt) - timestamp(a.submittedAt)
      );

    const bookings = (state.bookings || []).filter(booking =>
      dayKey(booking.scheduledAt) === today &&
      !["cancelled", "canceled", "declined", "rejected"]
        .includes(booking.status)
    );

    setText("dashboardDate", now.toLocaleDateString("en-PH", {
      timeZone: "Asia/Manila",
      month: "long",
      day: "numeric",
      year: "numeric"
    }));

    [
      ["dashboardPending", "providerApplications", pending.length],
      ["dashboardProviders", "users", providers.length],
      [
  "dashboardCustomers",
  "providerApplications",
  (state.providerApplications || []).length
],
      ["dashboardBookings", "bookings", bookings.length]
    ].forEach(([id, source, count]) => {
      setText(
        id,
        errors.has(source)
          ? "Unavailable"
          : state[source] === null ? "…" : count
      );
    });

    if (errors.has("users")) {
      setText("dashboardRenewals", "Permit records unavailable");
      setText("dashboardRenewalDetails", "");
    } else if (state.users === null) {
      setText("dashboardRenewals", "Checking permit renewals…");
      setText("dashboardRenewalDetails", "");
    } else {
      const renewalCount = providers.filter(provider => {
        const expiry = dayKey(provider.permitExpiry);
        return expiry && expiry <= deadline;
      }).length;

      const missing = providers.filter(
        provider => !dayKey(provider.permitExpiry)
      ).length;

      setText(
        "dashboardRenewals",
        `${renewalCount} provider${renewalCount === 1 ? "" : "s"} ` +
        "need permit renewal reminders"
      );

      setText(
        "dashboardRenewalDetails",
        "Expired permits or permits due within 30 days." +
        (missing ? ` ${missing} provider(s) have no expiry date recorded.` : "")
      );
    }

    renderList(
      "dashboardApplications",
      "providerApplications",
      pending,
      application => {
        const user = userMap.get(application.ownerId) || {};

        const row = document.createElement("a");
        row.className = "approval-row dashboard-application-link";
        row.href =
          "view-permit.html?application=" +
          encodeURIComponent(application.id);

        const avatar = document.createElement("div");
        avatar.className = "approval-avatar";

        avatar.appendChild(icon(
          "M20 20H4v-2c0-3 4-4 8-4s8 1 8 4v2M16 7a4 4 0 11-8 0 4 4 0 018 0"
        ));

        const info = document.createElement("div");
        info.className = "approval-info";

        const name = document.createElement("h4");
        name.textContent =
          application.fullName ||
          user.displayName ||
          application.email ||
          user.email ||
          "Name not provided";

        const details = document.createElement("p");
        details.textContent = [
          application.serviceCategory || user.serviceCategory,
          application.location || user.location
        ].filter(Boolean).join(" · ");

        info.append(name, details);
        row.append(avatar, info);

        return row;
      },
      "No pending applications."
    );
const sortedActivity = (state.activityLogs || [])
  .map(log => ({
    log,
    displayId: shortId(log.userId)
  }))
  .sort((a, b) => {
    const first = Number(a.displayId);
    const second = Number(b.displayId);

    return (
      (Number.isFinite(first) ? first : Infinity) -
      (Number.isFinite(second) ? second : Infinity)
    );
  })
  .map(item => item.log);

renderList(
  "dashboardActivity",
  "activityLogs",
  sortedActivity,
      log => {
        const row = document.createElement("div");
        row.className = "activity-row";

        const box = document.createElement("div");
        box.className = "activity-icon-box";
        box.appendChild(activityIcon(log.action));

        const details = document.createElement("div");
        details.className = "activity-details";

        const name = document.createElement("h4");
        name.textContent = shortId(log.userId);

        const action = document.createElement("p");
        action.textContent = [log.action, log.details]
          .filter(Boolean).join(" · ");

        details.append(name, action);
        row.append(box, details);

        return row;
      },
      "No recorded activity yet."
    );

    const errorBox = document.getElementById("dashboardError");
    if (errorBox) {
      errorBox.hidden = errors.size === 0;
      errorBox.textContent = errors.size
        ? `Could not load: ${[...errors].join(", ")}. Check your connection and Firestore permissions, then refresh.`
        : "";
    }
  }

  render();

  Object.keys(state).forEach(name => {
    const reference = name === "activityLogs"
      ? query(
          collection(db, name),
          orderBy("createdAt", "desc"),
          limit(4)
        )
      : collection(db, name);

    stops.push(onSnapshot(
      reference,
      snapshot => {
        state[name] = snapshot.docs.map(item => ({
          ...item.data(),
          id: item.id
        }));
        errors.delete(name);
        render();
      },
      error => {
        console.error(`Dashboard ${name}:`, error);
        errors.add(name);
        render();
      }
    ));
  });

  const timer = setInterval(render, 60000);

  window.addEventListener("pagehide", () => {
    stops.forEach(stop => stop());
    clearInterval(timer);
  }, { once: true });
}

async function handlePermitReview(ctx) {

    const id =
        qparam("application");


    if (!id) {
        return;
    }


    const applicationRef =
        doc(
            db,
            "providerApplications",
            id
        );


    const snapshot =
        await getDoc(
            applicationRef
        );


    if (!snapshot.exists()) {

        flash(
            "Application not found.",
            "error"
        );

        return;
    }


    const application = {

        id,

        ...snapshot.data()

    };


    // ========================================
    // SHOW PROVIDER INFORMATION
    // ========================================
const values = document.querySelectorAll(
  ".permit-details-card .info-group-list .info-box > span"
);

const statusElement = document.querySelector(
  ".permit-status-row span"
);

const stopApplicationDetails = onSnapshot(
  applicationRef,
  snapshot => {
    if (!snapshot.exists()) {
      flash("Application not found.", "error");
      return;
    }

    const data = snapshot.data();

    const information = [
      data.fullName || "Not provided",
      data.shopName || "Not provided",
      data.location || "Not provided",
      data.submittedAt
        ? dateText(data.submittedAt)
        : "Not recorded",
      data.permitExpiry || "Not recorded",
      data.contactNumber || "Not provided",
      data.email || "Email not recorded"
    ];

    values.forEach((element, index) => {
      element.textContent = String(information[index] ?? "");
    });

    const name = document.querySelector(".applicant-info h2");
    const service = document.querySelector(".applicant-info p");

    if (name) name.textContent = data.fullName || "Applicant";
    if (service) service.textContent = data.serviceCategory || "";

    // Keep the approval buttons synchronized with Firestore.
    currentStatus = data.status;
    updateReviewButtons();
  },
  error => {
    console.error("Application details:", error);
    flash("Could not load application details.", "error");
  }
);

window.addEventListener(
  "pagehide",
  stopApplicationDetails,
  { once: true }
);
    // ========================================
    // BUSINESS PERMIT
    // ========================================
const permitViewport = document.querySelector(".permit-image-viewport");
const fullSize = document.querySelector(".open-full-btn");

permitViewport.replaceChildren();
fullSize.hidden = true;
fullSize.removeAttribute("href");

let permitURL = null;

try {
  const parsed = new URL(application.permitURL);
  if (parsed.protocol === "https:") permitURL = parsed.href;
} catch {
  // Missing or invalid URL.
}

if (permitURL) {
 fullSize.href = "#permitViewer";
fullSize.removeAttribute("target");
fullSize.removeAttribute("rel");
fullSize.hidden = false;

document.getElementById("permitViewer")?.remove();

const viewer = document.createElement("dialog");
viewer.id = "permitViewer";
viewer.setAttribute("aria-labelledby", "permitViewerTitle");

viewer.innerHTML = `
  <div class="permit-viewer-layout">
    <header class="permit-viewer-header">
      <h2 id="permitViewerTitle">Business Permit</h2>

      <button type="button" class="permit-viewer-exit">
        Exit Preview ×
      </button>
    </header>

    <div class="permit-viewer-body"></div>
  </div>
`;

document.body.appendChild(viewer);

const viewerBody = viewer.querySelector(".permit-viewer-body");
let previousOverflow = "";

function restorePage() {
  document.body.style.overflow = previousOverflow;
  viewerBody.replaceChildren();
  fullSize.focus();
}

fullSize.onclick = event => {
  event.preventDefault();

  if (viewer.open) return;

  viewerBody.replaceChildren();

  const isPDF = /\.pdf(?:[?#]|$)/i.test(permitURL);

  if (isPDF) {
    const frame = document.createElement("iframe");
    frame.src = permitURL;
    frame.title = "Full business permit";
    viewerBody.appendChild(frame);
  } else {
    const image = document.createElement("img");
    image.src = permitURL;
    image.alt = "Full business permit";

    image.addEventListener("error", () => {
      viewerBody.textContent =
        "The permit could not be displayed. Close the preview and try again.";
    });

    viewerBody.appendChild(image);
  }

  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  viewer.showModal();
};

viewer.querySelector(".permit-viewer-exit")
  .addEventListener("click", () => viewer.close());

viewer.addEventListener("close", restorePage);

  const isPDF = /\.pdf(?:[?#]|$)/i.test(permitURL);

  if (isPDF) {
    permitViewport.textContent =
      "PDF permit uploaded. Click Open Full Size to view it.";
  } else {
    const image = document.createElement("img");
    image.className = "permit-thumbnail";
    image.alt = "Submitted business permit";
    image.src = permitURL;

    image.addEventListener("error", () => {
      permitViewport.textContent =
        "Preview unavailable. Click Open Full Size to view the document.";
    });

    permitViewport.appendChild(image);
  }
} else {
  permitViewport.textContent = "No valid permit document uploaded.";
}

const dateLabel = document.querySelector(".header-title p");

if (dateLabel) {
  dateLabel.textContent = new Date().toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}


    // ========================================
    // APPROVE / DECLINE
    // ========================================
const approveButton = document.querySelector(".btn-action-approve");
const declineButton = document.querySelector(".btn-action-decline");
const statusLabel = document.querySelector(".permit-status-row span");

let busy = false;
let currentStatus = application.status;
function updateReviewButtons() {
  const pending = currentStatus === "pending";

  approveButton.disabled = busy || !pending;
  declineButton.disabled = busy || !pending;

  approveButton.textContent = busy ? "Saving…" : "Approve";
  declineButton.textContent = "Decline";

  if (statusLabel) {
    const labels = {
      pending: "Pending",
      approved: "Approved",
      declined: "Declined"
    };

    statusLabel.textContent =
      labels[currentStatus] || "Status not recorded";

    statusLabel.className = `status-badge ${
      ["pending", "approved", "declined"].includes(currentStatus)
        ? currentStatus
        : ""
    }`;
  }
}

approveButton.addEventListener("click", () => {
  setStatus("approved");
});

declineButton.addEventListener("click", () => {
  setStatus("declined");
});

updateReviewButtons();
async function setStatus(status) {
  if (
    busy ||
    currentStatus !== "pending" ||
    !["approved", "declined"].includes(status)
  ) return;

  busy = true;
  updateReviewButtons();

  try {
    await runTransaction(db, async transaction => {
      const latestApplication = await transaction.get(applicationRef);

      if (!latestApplication.exists()) {
        throw new Error("Application no longer exists.");
      }

      const data = latestApplication.data();

      if (data.status !== "pending") {
        throw new Error("This application was already reviewed. Refresh the page.");
      }

      if (!data.ownerId) {
        throw new Error("The application has no linked user account.");
      }

      const userRef = doc(db, "users", data.ownerId);
      const userSnapshot = await transaction.get(userRef);

      if (!userSnapshot.exists()) {
        throw new Error("The applicant's user profile could not be found.");
      }

      const profile = userSnapshot.data();
      const approved = status === "approved";

      // Do not accidentally turn the administrator into a provider.
      if (approved && profile.role === "admin") {
        throw new Error(
          "This application belongs to an admin account. Submit it using the applicant's own account."
        );
      }

      transaction.update(applicationRef, {
        status,
        reviewedBy: ctx.user.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      if (approved) {
        const provider = {
          role: "provider",
          verified: true,
          displayName:
            data.fullName || profile.displayName || "Provider",
              shopName: data.shopName || "",
          serviceCategory: data.serviceCategory || "",
          skills: Array.isArray(data.skills) ? data.skills : [],
          bio: data.bio || "",
          location: data.location || "",
          contactNumber: data.contactNumber || "",
          photoURL: data.photoURL || profile.photoURL || "",
          permitURL: data.permitURL || "",
          permitExpiry: data.permitExpiry || "",
          price: Number(data.price) || 0,
          providerApprovedAt:
            profile.providerApprovedAt || serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        for (const key of ["latitude", "longitude"]) {
          if (
            data[key] !== null &&
            data[key] !== undefined &&
            data[key] !== "" &&
            Number.isFinite(Number(data[key]))
          ) {
            provider[key] = Number(data[key]);
          }
        }

        transaction.update(userRef, provider);
      }

      transaction.set(
        doc(db, "notifications", `application-${applicationRef.id}-${status}`),
        {
          userId: data.ownerId,
          type: "provider_application",
          title: approved
            ? "Provider Application Approved"
            : "Provider Application Declined",
          message: approved
            ? "Your application was approved. You can now open your provider dashboard using your existing account."
            : "Your application was declined. Contact REPARO administration for details.",
          link: approved ? "rm-index.html" : "application-done.html",
          read: false,
          createdAt: serverTimestamp()
        }
      );
    });

    currentStatus = status;
    flash(`Application ${status}.`);

    location.href = status === "approved"
      ? "admin-provider.html"
      : "admin-approval.html";
  } catch (error) {
    console.error("Application review:", error);
    flash(error.message || "Could not save the decision.", "error");
  } finally {
    busy = false;
    updateReviewButtons();
  }
}
}

async function handleAdminProviders() {
  const tableElement = document.querySelector(".approval-table");
  if (!tableElement) {
    throw new Error("Registered Provider table was not found.");
  }

  const table =
    tableElement.tBodies[0] || tableElement.createTBody();

  const dateElement = document.getElementById("registeredProviderDate");

  function updateDate() {
    if (dateElement) {
      dateElement.textContent = new Date().toLocaleDateString("en-PH", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    }
  }

  function showMessage(message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.textContent = message;

    row.appendChild(cell);
    table.replaceChildren(row);
  }

  function formatJoined(value) {
    if (!value) return "Not recorded";

    const date = typeof value.toDate === "function"
      ? value.toDate()
      : new Date(value);

    if (Number.isNaN(date.getTime())) return "Not recorded";

    return date.toLocaleDateString("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function addCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = String(value ?? "Not provided");
    row.appendChild(cell);
  }

  updateDate();
  showMessage("Connecting to Firestore…");

  const stop = onSnapshot(
    query(
      collection(db, "users"),
      where("role", "==", "provider")
    ),
  async snapshot => {
      try {
        if (snapshot.empty) {
          showMessage("No accounts with the provider role were found.");
          return;
        }

        const content = document.createDocumentFragment();

        for (const providerDoc of snapshot.docs) {
          const provider = providerDoc.data();
          const row = document.createElement("tr");

          const providerCell = document.createElement("td");
          const info = document.createElement("div");
          info.className = "provider-info";

          const name = document.createElement("strong");
          name.textContent =
            provider.displayName ||
            provider.fullName ||
            "Provider";

          const email = document.createElement("span");
          email.textContent = provider.email || "Email not recorded";

          info.append(name, email);
          providerCell.appendChild(info);

          // The full Firebase UID is available on hover.
          providerCell.title = `Provider UID: ${providerDoc.id}`;
          row.appendChild(providerCell);
          let shopName = String(provider.shopName || "").trim();

if (!shopName) {
  const applicationSnapshot = await getDoc(
    doc(db, "providerApplications", providerDoc.id)
  );

  if (applicationSnapshot.exists()) {
    shopName = String(
      applicationSnapshot.data().shopName || ""
    ).trim();
  }
}

addCell(row, shopName || "Not provided");
          addCell(row, provider.serviceCategory || "Not provided");
          addCell(row, provider.location || "Not provided");
          addCell(row, formatJoined(provider.providerApprovedAt));

          content.appendChild(row);
        }

        // Replace the table only after all rows are built successfully.
        table.replaceChildren(content);
      } catch (error) {
        console.error("Provider display error:", error);
        showMessage(`Could not display providers: ${error.message}`);
      }
    },
    error => {
      console.error("Provider Firestore error:", error);
      showMessage(
        `Could not load providers: ${error.code || error.message}`
      );
    }
  );

  const timer = setInterval(updateDate, 60000);

  window.addEventListener("pagehide", () => {
    stop();
    clearInterval(timer);
  }, { once: true });
}
async function handleAdminLogs() {
  const tableElement = document.getElementById("liveActivityTable");
  if (!tableElement) return;

  const table = tableElement.tBodies[0] || tableElement.createTBody();

  // Reuse the dashboard's browser-saved short IDs.
  let savedIds = [];

  try {
    const saved = JSON.parse(
      localStorage.getItem("reparo-admin-display-ids") || "[]"
    );

    if (Array.isArray(saved)) {
      savedIds = saved.filter(entry =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        Number.isInteger(entry[1]) &&
        entry[1] >= 101
      );
    }
  } catch (error) {
    console.warn("Could not load display IDs:", error);
  }

  const displayIds = new Map(savedIds);

  function shortId(uid) {
    if (!uid) return "Unknown";

    if (!displayIds.has(uid)) {
      let next = 101;

      displayIds.forEach(value => {
        next = Math.max(next, value + 1);
      });

      displayIds.set(uid, next);

      try {
        localStorage.setItem(
          "reparo-admin-display-ids",
          JSON.stringify([...displayIds])
        );
      } catch (error) {
        console.warn("Could not save display IDs:", error);
      }
    }

    return String(displayIds.get(uid));
  }

  function updateDate() {
    const date = document.getElementById("activityLogsDate");

    if (date) {
      date.textContent = new Date().toLocaleDateString("en-PH", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    }
  }

  function formatTime(value) {
    if (!value) return "Time not recorded";

    const date = value?.toDate ? value.toDate() : new Date(value);

    if (Number.isNaN(date.getTime())) return "Time not recorded";

    return date.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function actionIcon(action) {
    const value = String(action || "").toLowerCase();

    let path = "M6 2h8l4 4v16H6V2M14 2v5h4M9 12h6M9 16h6";
    let color = "#D97706";

    if (/declin|reject|cancel|delet/.test(value)) {
      path = "M6 6l12 12M18 6L6 18";
      color = "#DC2626";
    } else if (/approv|accept|complet/.test(value)) {
      path = "M5 12l4 4L19 6";
      color = "#0D9488";
    } else if (/log|sign/.test(value)) {
      path = "M14 4h6v16h-6M3 12h12M11 8l4 4-4 4";
      color = "#0D9488";
    } else if (/book|schedul/.test(value)) {
      path = "M4 5h16v15H4V5M4 10h16M8 3v4M16 3v4";
      color = "#2563EB";
    } else if (/edit|updat/.test(value)) {
      path = "M4 16L15 5l4 4L8 20H4v-4M13 7l4 4";
      color = "#7C3AED";
    } else if (/message|chat|comment/.test(value)) {
      path = "M3 4h18v13H8l-5 4V4M7 9h10M7 13h6";
      color = "#0891B2";
    }

    const svg = document.createElementNS(
      "http://www.w3.org/2000/svg", "svg"
    );

    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");

    const shape = document.createElementNS(
      "http://www.w3.org/2000/svg", "path"
    );

    shape.setAttribute("d", path);
    shape.setAttribute("fill", "none");
    shape.setAttribute("stroke", color);
    shape.setAttribute("stroke-width", "2");
    shape.setAttribute("stroke-linecap", "round");
    shape.setAttribute("stroke-linejoin", "round");

    svg.appendChild(shape);
    return svg;
  }

  function showMessage(message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 4;
    cell.textContent = message;

    row.appendChild(cell);
    table.replaceChildren(row);
  }

  updateDate();
  showMessage("Connecting to Firestore…");

  const stop = onSnapshot(
    query(
      collection(db, "activityLogs"),
      orderBy("createdAt", "desc"),
      limit(100)
    ),
    snapshot => {
      try {
        if (snapshot.empty) {
          showMessage("No activity recorded yet.");
          return;
        }

        const content = document.createDocumentFragment();

       const sortedLogs = snapshot.docs.map(logDoc => {
  const log = logDoc.data();

  return {
    log,
    displayId: shortId(log.userId)
  };
});

sortedLogs.sort((a, b) => {
  const first = Number(a.displayId);
  const second = Number(b.displayId);

  return (
    (Number.isFinite(first) ? first : Infinity) -
    (Number.isFinite(second) ? second : Infinity)
  );
});

sortedLogs.forEach(({ log }) => {
          const row = document.createElement("tr");

          const userCell = document.createElement("td");
          userCell.className = "log-user-id";
          userCell.textContent = shortId(log.userId);
          userCell.title = log.userId || "";

          const timeCell = document.createElement("td");
          timeCell.className = "log-time";
          timeCell.textContent = formatTime(log.createdAt);

          const actionCell = document.createElement("td");
          const action = document.createElement("div");
          action.className = "action-cell";

          const icon = document.createElement("div");
          icon.className = "action-icon-box";
          icon.appendChild(actionIcon(log.action));

          const label = document.createElement("span");
          label.className = "action-text";
          label.textContent = log.action || "Action not recorded";

          action.append(icon, label);
          actionCell.appendChild(action);

          const detailsCell = document.createElement("td");
          detailsCell.className = "log-details";

          const details =
            log.serviceCategory || log.service || log.details;

          detailsCell.textContent = Array.isArray(details)
            ? details.join(", ")
            : details
              ? String(details)
              : "—";

          row.append(userCell, timeCell, actionCell, detailsCell);
          content.appendChild(row);
        });

        table.replaceChildren(content);
      } catch (error) {
        console.error("Activity display:", error);
        showMessage(`Could not display activity: ${error.message}`);
      }
    },
    error => {
      console.error("Activity logs:", error);
      showMessage(
        `Could not load activity: ${error.code || error.message}`
      );
    }
  );

  const timer = setInterval(updateDate, 60000);

  window.addEventListener("pagehide", () => {
    stop();
    clearInterval(timer);
  }, { once: true });
}
async function handleAdminReminders(ctx) {
  const host = document.getElementById("renewalReminders");
  if (!host) return;

  let providers = null;
  let reminders = null;

  const errors = new Set();
  const sending = new Set();
  const stops = [];

  function dateKey(value) {
    if (!value) return "";

    if (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      const date = new Date(value + "T00:00:00Z");

      return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
        ? value
        : "";
    }

    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(date).map(part => [part.type, part.value])
    );

    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function daysRemaining(expiry) {
    const today = dateKey(new Date());

    return Math.round(
      (
        Date.parse(expiry + "T00:00:00Z") -
        Date.parse(today + "T00:00:00Z")
      ) / 86400000
    );
  }

  function reminderId(provider) {
    return `${provider.id}_${dateKey(provider.permitExpiry)}`;
  }

  function svg(path) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="${path}"></path>
    </svg>`;
  }

  const icons = {
    person:
      "M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z",
    calendar:
      "M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z",
    clock:
      "M12 2a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16zm1-13h-2v6l5 3 1-1.7-4-2.3V7z",
    email:
      "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
    send:
      "M2 21l21-9L2 3v7l15 2-15 2v7z",
    check:
      "M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"
  };

  async function sendReminder(provider) {
    const id = reminderId(provider);
    if (sending.has(id)) return;

    sending.add(id);
    render();

    try {
      const expiry = dateKey(provider.permitExpiry);

      const reminderRef = doc(db, "adminReminders", id);
      const notificationRef = doc(
        db, "notifications", `permit-renewal_${id}`
      );
      const userRef = doc(db, "users", provider.id);

      const created = await runTransaction(db, async transaction => {
        const existing = await transaction.get(reminderRef);
        const latestUser = await transaction.get(userRef);

        if (existing.exists()) return false;

        const latest = latestUser.data();

        if (
          !latestUser.exists() ||
          latest.role !== "provider" ||
          latest.disabled === true ||
          ["disabled", "suspended", "inactive"].includes(latest.status) ||
          dateKey(latest.permitExpiry) !== expiry ||
          daysRemaining(expiry) > 30
        ) {
          throw new Error(
            "This provider's permit information changed. Please refresh."
          );
        }

        const days = daysRemaining(expiry);

        const message = days < 0
          ? `Your business permit expired on ${expiry}. Please renew it and contact REPARO administration to update your permit record.`
          : `Your business permit expires on ${expiry}. Please renew it and contact REPARO administration to update your permit record.`;

        transaction.set(reminderRef, {
          providerId: provider.id,
          createdBy: ctx.user.uid,
          type: "permit-renewal",
          permitExpiry: expiry,
          notificationId: notificationRef.id,
          createdAt: serverTimestamp()
        });

        transaction.set(notificationRef, {
          link: "rm-permit-renewal.html",
          userId: provider.id,
           adminId: ctx.user.uid,
          type: "provider_permit_renewal",
          title: "Business Permit Renewal Reminder",
          message: days < 0
          ? `Your business permit expired on ${expiry}. Upload your renewed permit for administrator review.`
          : `Your business permit expires on ${expiry}. Upload your renewed permit for administrator review.`,
          permitExpiry: expiry,
          read: false,
          createdAt: serverTimestamp()
        });

        return true;
      });

      flash(
        created
          ? "Reminder sent to the provider's notifications."
          : "A reminder was already sent for this permit expiry."
      );
    } catch (error) {
      console.error("Permit reminder:", error);
      flash(error.message || "Could not send reminder.", "error");
    } finally {
      sending.delete(id);
      render();
    }
  }

  function render() {
    host.replaceChildren();

    const dateLabel = document.querySelector(".header-title p");
    if (dateLabel) {
      dateLabel.textContent = new Date().toLocaleDateString("en-PH", {
        timeZone: "Asia/Manila",
        month: "long",
        day: "numeric",
        year: "numeric"
      });
    }

    if (errors.size) {
      host.textContent =
        `Unable to load ${[...errors].join(" and ")}. Please refresh.`;
      return;
    }

    if (providers === null || reminders === null) {
      host.textContent = "Connecting to Firestore…";
      return;
    }

    const active = providers.filter(provider =>
      provider.disabled !== true &&
      !["disabled", "suspended", "inactive"].includes(provider.status)
    );

    const missingExpiry = active.filter(
      provider => !dateKey(provider.permitExpiry)
    ).length;

    const due = active
      .filter(provider => {
        const expiry = dateKey(provider.permitExpiry);
        return expiry && daysRemaining(expiry) <= 30;
      })
      .sort((a, b) =>
        dateKey(a.permitExpiry).localeCompare(dateKey(b.permitExpiry))
      );

    const description = document.querySelector(
      ".reminders-banner .alert-text p"
    );

    if (description) {
      description.textContent =
        `${due.length} provider(s) have expired permits or permits due within 30 days.` +
        (missingExpiry
          ? ` ${missingExpiry} provider(s) have no valid expiry date recorded.`
          : "");
    }

    if (!due.length) {
      host.textContent = "No permit renewals due within 30 days.";
      return;
    }

    due.forEach(provider => {
      const id = reminderId(provider);
      const expiry = dateKey(provider.permitExpiry);
      const days = daysRemaining(expiry);
      const sent = reminders.has(id);
      const busy = sending.has(id);

      const card = document.createElement("div");
      card.className = "reminder-item-card";

      // Static design markup. Database values are assigned below.
      card.innerHTML = `
        <div class="reminder-left">
          <div class="avatar-circle">
            ${svg(icons.person)}
          </div>

          <div class="reminder-details">
            <h3></h3>
            <p class="business-name"></p>

            <div class="meta-row">
              <span class="meta-item">
                ${svg(icons.calendar)}
                <span data-expiry></span>
              </span>

              <span class="meta-item">
                ${svg(icons.clock)}
                <span data-days></span>
              </span>

              <span class="meta-item">
                ${svg(icons.email)}
                <span data-email></span>
              </span>
            </div>
          </div>
        </div>

        <button type="button"></button>
      `;

      card.querySelector("h3").textContent =
        provider.displayName ||
        provider.fullName ||
        provider.email ||
        "Name not provided";

      card.querySelector(".business-name").textContent =
        provider.businessName || provider.serviceCategory || "";

      card.querySelector("[data-expiry]").textContent =
        `Expires: ${expiry}`;

      card.querySelector("[data-days]").textContent =
        days < 0
          ? `Expired ${Math.abs(days)} day(s) ago`
          : days === 0
            ? "Expires today"
            : `${days} day(s) left`;

      card.querySelector("[data-email]").textContent =
        provider.email || "Email not recorded";

      const button = card.querySelector("button");
      button.className = sent ? "sent-btn" : "send-btn";
      button.disabled = sent || busy;

      button.innerHTML = svg(sent ? icons.check : icons.send);

      button.appendChild(document.createTextNode(
        busy
          ? " Sending…"
          : sent
            ? " Reminder Sent"
            : " Send Reminder"
      ));

      button.addEventListener("click", () => sendReminder(provider));

      host.appendChild(card);
    });
  }

  render();

  stops.push(onSnapshot(
    query(collection(db, "users"), where("role", "==", "provider")),
    snapshot => {
      providers = snapshot.docs.map(item => ({
        ...item.data(),
        id: item.id
      }));
      render();
    },
    error => {
      console.error(error);
      errors.add("providers");
      render();
    }
  ));

  stops.push(onSnapshot(
    collection(db, "adminReminders"),
    snapshot => {
      reminders = new Set(snapshot.docs.map(item => item.id));
      render();
    },
    error => {
   console.error("adminReminders listener failed:", error);

errors.add(
  `reminder records (${error.code || error.message})`
);

render();
    }
  ));

  const timer = setInterval(render, 60000);

  window.addEventListener("pagehide", () => {
    stops.forEach(stop => stop());
    clearInterval(timer);
  }, { once: true });
}

async function handleAdminSettings(ctx) {
  const form=document.querySelector(".security-form"); if(!form)return;
  form.addEventListener("submit",async e=>{e.preventDefault();const inputs=form.querySelectorAll('input[type="password"]');const current=inputs[0]?.value||"",next=inputs[1]?.value||"",confirm=inputs[2]?.value||"";if(next!==confirm)return flash("New passwords do not match.","error");if(next.length<8)return flash("New password must be at least 8 characters.","error");try{await reauthenticateWithCredential(ctx.user,EmailAuthProvider.credential(ctx.user.email,current));await updatePassword(ctx.user,next);form.reset();flash("Admin password updated.");}catch(err){flash(err.message,"error");}});
}

async function handleAdminEdit(ctx) {
  const form=document.querySelector(".edit-form"); if(!form)return; const inputs=form.querySelectorAll("input"); if(inputs[0])inputs[0].value=ctx.profile?.displayName||ctx.user.displayName||""; if(inputs[1])inputs[1].value=ctx.user.email||"";
  form.addEventListener("submit",async e=>{e.preventDefault();try{await setDoc(doc(db,"users",ctx.user.uid),{displayName:inputs[0]?.value.trim()||ctx.profile?.displayName||"",email:ctx.user.email,updatedAt:serverTimestamp()},{merge:true});flash("Profile saved.");}catch(err){flash(err.message,"error");}});
}
async function handleAdminSupport(ctx) {
  const main = document.querySelector(".admin-main");
  const header = main?.querySelector(".top-bar");
  if (!main || !header) return;

  [...main.children].forEach(element => {
    if (element !== header) element.remove();
  });

  const date = header.querySelector(".header-title p");
  if (date) {
    date.textContent = new Date().toLocaleDateString("en-US", {
      timeZone: "Asia/Manila",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  const layout = document.createElement("section");
  layout.className = "live-support";
  layout.innerHTML = `
    <aside class="live-support-list">
      <h3>Conversations</h3>
      <div id="supportPeers">Loading conversations…</div>
    </aside>

    <section class="live-support-thread">
      <h3 id="supportPeerName">Select a conversation</h3>
      <p id="supportError" role="status"></p>
      <div id="supportMessages" class="live-chat-messages"
           aria-live="polite"></div>
      <div class="live-support-compose">
        <input id="supportInput" placeholder="Type a message…"
               aria-label="Message" maxlength="5000" disabled>
        <button id="supportSend" type="button" disabled>Send</button>
      </div>
    </section>
  `;
  main.append(layout);

  const peers = layout.querySelector("#supportPeers");
  const heading = layout.querySelector("#supportPeerName");
  const body = layout.querySelector("#supportMessages");
  const errorBox = layout.querySelector("#supportError");
  const input = layout.querySelector("#supportInput");
  const sendButton = layout.querySelector("#supportSend");

  const uid = ctx.user.uid;
  const incoming = new Map();
  const outgoing = new Map();
  const profiles = new Map();
  const profileListeners = new Map();
  const loaded = new Set();

  let messages = [];
  let selectedPeer = "";
  let sending = false;
  let stopped = false;

  const timeOf = message => message.createdAt?.toMillis?.() || 0;
  const peerOf = message =>
    message.senderId === uid ? message.receiverId : message.senderId;

  function displayName(peerId) {
    const profile = profiles.get(peerId);
    return profile?.displayName || profile?.fullName || peerId;
  }

  function renderThread() {
    heading.textContent = selectedPeer
      ? displayName(selectedPeer)
      : "Select a conversation";

    input.disabled = !selectedPeer || sending;
    sendButton.disabled = !selectedPeer || sending;
    body.replaceChildren();

    if (!selectedPeer) {
      body.textContent = "Select a customer or provider to view messages.";
      return;
    }

    const thread = messages.filter(
      message => peerOf(message) === selectedPeer
    );

    if (!thread.length) {
      body.textContent = "No messages in this conversation.";
      return;
    }

    for (const message of thread) {
      const bubble = document.createElement("div");
      bubble.className = "live-chat-bubble" +
        (message.senderId === uid ? " sent" : "");
      bubble.textContent = message.text || "";
      body.append(bubble);
    }

    body.scrollTop = body.scrollHeight;
  }

  function renderPeers() {
    peers.replaceChildren();

    const latest = new Map();
    for (const message of messages) {
      latest.set(peerOf(message), message);
    }

    if (!latest.size) {
      peers.textContent = loaded.size === 2
        ? "No support conversations yet."
        : "Loading conversations…";
      return;
    }

    for (const [peerId, message] of [...latest].reverse()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "live-support-peer";
      button.setAttribute("aria-pressed", String(peerId === selectedPeer));

      const name = document.createElement("strong");
      name.textContent = displayName(peerId);

      const preview = document.createElement("span");
      preview.textContent = message.text || "";

      button.append(name, preview);
      button.addEventListener("click", () => {
        selectedPeer = peerId;
        input.value = "";
        renderPeers();
        renderThread();
      });
      peers.append(button);
    }
  }

  function refresh() {
    const combined = new Map([...incoming, ...outgoing]);
    messages = [...combined.values()].sort(
      (a, b) => timeOf(a) - timeOf(b)
    );

    for (const message of messages) {
      const peerId = peerOf(message);
      if (!peerId || profileListeners.has(peerId)) continue;

      const unsubscribe = onSnapshot(
        doc(db, "users", peerId),
        snapshot => {
          if (stopped) return;
          profiles.set(peerId, snapshot.data() || {});
          renderPeers();
          if (selectedPeer === peerId) {
            heading.textContent = displayName(peerId);
          }
        },
        error => {
          console.error("Support profile:", error);
        }
      );
      profileListeners.set(peerId, unsubscribe);
    }

    renderPeers();
    renderThread();
  }

  function listen(field, target) {
    return onSnapshot(
      query(collection(db, "messages"), where(field, "==", uid)),
      snapshot => {
        if (stopped) return;
        target.clear();
        snapshot.forEach(messageDoc => {
          target.set(messageDoc.id, messageDoc.data());
        });
        loaded.add(field);
        refresh();
      },
      error => {
        errorBox.textContent =
          `Unable to load messages (${error.code}).`;
        peers.textContent = "Messages could not be fully loaded.";
        console.error("Support messages:", error);
      }
    );
  }

  const stopIncoming = listen("receiverId", incoming);
  const stopOutgoing = listen("senderId", outgoing);

  async function sendMessage() {
    
    const text = input.value.trim();
    const receiverId = selectedPeer;
    if (!text || !receiverId || sending) return;

    sending = true;
    input.disabled = true;
    sendButton.disabled = true;

    try {
      await addDoc(collection(db, "messages"), {
        conversationId: [uid, receiverId].sort().join("_"),
        senderId: uid,
        receiverId,
        text,
        createdAt: serverTimestamp()
      });

      if (selectedPeer === receiverId && input.value.trim() === text) {
        input.value = "";
      }
    } catch (error) {
      errorBox.textContent = `Message was not sent: ${error.message}`;
    } finally {
      sending = false;
      input.disabled = !selectedPeer;
      sendButton.disabled = !selectedPeer;
    }
  }

  sendButton.addEventListener("click", sendMessage);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });

  window.addEventListener("pagehide", () => {
    stopped = true;
    stopIncoming();
    stopOutgoing();
    profileListeners.forEach(unsubscribe => unsubscribe());
  }, { once: true });
}
function watchMyMessages(uid, onChange, onError) {
  const incoming = new Map();
  const outgoing = new Map();
  const ready = new Set();

  function receive(source, target, snapshot) {
    target.clear();

    snapshot.forEach(messageDoc => {
      target.set(messageDoc.id, {
        ...messageDoc.data(),
        id: messageDoc.id
      });
    });

    ready.add(source);
    if (ready.size !== 2) return;

    const combined = new Map([...incoming, ...outgoing]);

    onChange(
      [...combined.values()].sort(
        (a, b) =>
          (a.createdAt?.toMillis?.() || 0) -
          (b.createdAt?.toMillis?.() || 0)
      )
    );
  }

  const stopIncoming = onSnapshot(
    query(
      collection(db, "messages"),
      where("receiverId", "==", uid)
    ),
snapshot => receive("incoming", incoming, snapshot),
error => {
  console.error("Incoming messages query:", error);
  onError(error);
}
  );

  const stopOutgoing = onSnapshot(
    query(
      collection(db, "messages"),
      where("senderId", "==", uid)
    ),
 snapshot => receive("outgoing", outgoing, snapshot),
error => {
  console.error("Outgoing messages query:", error);
  onError(error);
}
  );

  return () => {
    stopIncoming();
    stopOutgoing();
  };
}async function handleChat(ctx) {
    const chatNavigationParams = new URLSearchParams(location.search);

  const chatBackArrow = document.querySelector(
    ".chat-header a.back-btn"
  );

  if (chatBackArrow) {
    const fromBookings =
      chatNavigationParams.get("back") === "bookings";

    const providerConversation =
      chatNavigationParams.get("from") === "provider" ||
      ctx.profile?.role === "provider";

   if (
  chatNavigationParams.get("back") === "profile" &&
  chatNavigationParams.get("with")
) {
  chatBackArrow.href =
    `service.html?provider=${encodeURIComponent(
      chatNavigationParams.get("with")
    )}`;

  chatBackArrow.setAttribute(
    "aria-label",
    "Back to provider profile"
  );
} else if (chatNavigationParams.get("back") === "home") {
  chatBackArrow.href = "index.html";
  chatBackArrow.setAttribute(
    "aria-label",
    "Back to home"
  );
} else if (chatNavigationParams.get("back") === "search") {
  chatBackArrow.href = "search.html";
  chatBackArrow.setAttribute("aria-label", "Back to search");
} else if (chatNavigationParams.get("back") === "myprofile") {
  chatBackArrow.href = "myprofile.html";
  chatBackArrow.setAttribute("aria-label", "Back to my profile");
} else if (fromBookings) {
      const allowedBookingFilters = [
        "all",
        "pending",
        "confirmed",
        "completed",
        "declined",
        "cancelled"
      ];

      const requestedBookingFilter =
        chatNavigationParams.get("status");

      const returnBookingFilter =
        allowedBookingFilters.includes(requestedBookingFilter)
          ? requestedBookingFilter
          : "all";

      chatBackArrow.href =
        `rm-booking.html?status=${returnBookingFilter}`;

      chatBackArrow.setAttribute(
        "aria-label",
        "Back to bookings"
      );
    } else {
      chatBackArrow.href = providerConversation
        ? "message.html?from=provider"
        : "message.html";

      chatBackArrow.setAttribute(
        "aria-label",
        "Back to messages"
      );
    }
  }
  const peerId = new URLSearchParams(location.search).get("with");

  const input = document.querySelector(".chat-input");
  const send = document.querySelector('[aria-label="Send message"]');
  const body = document.querySelector(".empty-chat, .chat-messages");
  const heading = document.querySelector(".header-titles h1");
  const subtitle = document.querySelector(".header-titles .subtitle");
  const status = document.getElementById("chatStatus");

  if (!input || !send || !body || !status) return;

  let sending = false;
  let closed = false;
  let peerName = "";

  function showStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  // These controls do not yet have implemented actions.
  document.querySelector(".call-btn")?.setAttribute("hidden", "");
  document.querySelector('[aria-label="Add attachment"]')
    ?.setAttribute("hidden", "");

  body.classList.remove("empty-chat");
  body.classList.add("live-chat-messages");
  body.textContent = "Loading messages…";

  if (!peerId || peerId === ctx.user.uid) {
    body.textContent = "Select another person to start a conversation.";
    if (heading) heading.textContent = "Chat";
    send.disabled = true;
    input.disabled = true;
    return;
  }

  const conversationId = [ctx.user.uid, peerId].sort().join("_");

const supportAdminUid = "KKutxcZ55YSls3WKMuvfgvMZjKA3";
const chattingWithSupport = peerId === supportAdminUid;

if (heading) {
  heading.textContent = chattingWithSupport
    ? "CHAT SUPPORT"
    : "Loading conversation…";
}
if (subtitle) {
  subtitle.textContent = chattingWithSupport
    ? "REPARO Administration"
    : "";
}

  // A profile lookup may be restricted for customer profiles.
  // Incoming messages also carry the sender's display name.
  getUserProfile(peerId).then(profile => {
    if (closed || !profile) return;
const image = document.getElementById("chatPeerPhoto");
const fallback = document.getElementById("chatPeerFallback");
const phoneLink = document.getElementById("chatPhoneLink");

if (image && fallback) {
  image.hidden = true;
  fallback.hidden = false;

  image.onload = () => {
    image.hidden = false;
    fallback.hidden = true;
  };

  image.onerror = () => {
    image.hidden = true;
    fallback.hidden = false;
  };

  image.alt = profile.displayName || profile.fullName || "Profile photo";

  try {
    const url = new URL(profile.photoURL);
    if (url.protocol === "https:") image.src = url.href;
  } catch {
    // Keep the person icon if no photo is saved.
  }
}

if (phoneLink) {
  const number = String(profile.contactNumber || "")
    .replace(/[^\d+]/g, "");

  if (/^\+?\d{7,15}$/.test(number)) {
    phoneLink.href = `tel:${number}`;
    phoneLink.hidden = false;
  }
}
    peerName = profile.displayName || profile.fullName || "";
    if (heading && peerName && !chattingWithSupport) {
  heading.textContent = peerName;
}

   if (subtitle && !chattingWithSupport) {
  subtitle.textContent =
    profile.serviceCategory ||
    (profile.role === "provider" ? "Provider" : "Customer");
}
}).catch(error => {
  console.warn("Chat profile unavailable:", error.code);
  if (heading && !chattingWithSupport &&
      heading.textContent === "Loading conversation…") {
    heading.textContent = "Conversation";
  }
});
const bookingField =
  ctx.profile?.role === "provider" ? "providerId" : "customerId";

const stopChatBooking = onSnapshot(
  query(
    collection(db, "bookings"),
    where(bookingField, "==", ctx.user.uid)
  ),
  snapshot => {
    const banner = document.getElementById("chatBookingBanner");
    if (!banner) return;

    const bookings = snapshot.docs
      .map(document => document.data())
      .filter(booking =>
        (booking.customerId === ctx.user.uid &&
         booking.providerId === peerId) ||
        (booking.providerId === ctx.user.uid &&
         booking.customerId === peerId)
      )
      .sort((a, b) =>
        (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
      );

    const booking = bookings[0];
    banner.hidden = !booking;

    if (!booking) return;

    const date = booking.scheduledAt?.toDate
      ? booking.scheduledAt.toDate()
      : new Date(booking.scheduledAt);

    const dateLabel = Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString("en-PH", {
          month: "short",
          day: "numeric"
        });

    const rawPrice = booking.price;
    const price = rawPrice !== "" && rawPrice != null
      ? Number(rawPrice)
      : NaN;

    const priceLabel = Number.isFinite(price)
      ? new Intl.NumberFormat("en-PH", {
          style: "currency",
          currency: "PHP"
        }).format(price)
      : "";

    document.getElementById("chatBookingText").textContent = [
      booking.service,
      dateLabel,
      priceLabel
    ].filter(Boolean).join(" · ");

    document.getElementById("chatBookingState").textContent =
      booking.status || "";
  },
  error => {
    console.error("Chat booking:", error);
    const banner = document.getElementById("chatBookingBanner");
    if (banner) banner.hidden = true;
  }
);

window.addEventListener("pagehide", stopChatBooking, { once: true });
  const stopMessages = watchMyMessages(
    ctx.user.uid,
    records => {
      const messages = records.filter(message =>
        (message.senderId === ctx.user.uid &&
         message.receiverId === peerId) ||
        (message.senderId === peerId &&
         message.receiverId === ctx.user.uid)
      );

      if (!peerName) {
        const incoming = [...messages].reverse().find(message =>
          message.senderId === peerId && message.senderName
        );

        if (incoming && heading) {
          heading.textContent = incoming.senderName;
        }
      }

      const nearBottom =
        body.scrollHeight - body.scrollTop - body.clientHeight < 100;

      body.replaceChildren();

     if (!messages.length) {
  const empty = document.createElement("div");
  empty.className = "chat-empty-state";

  // Static design only—no sample messages or user information.
  empty.innerHTML = `
    <div class="empty-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M5 4h14a2 2 0 0 1 2 2v12H8l-5 3V6a2 2 0 0 1 2-2Z"/>
        <path d="M8 9v3m4-3v3m4-3v3"/>
      </svg>
    </div>
    <h2>No messages yet</h2>
    <p>Start the conversation here.</p>
  `;

  body.append(empty);
  return;
}

      for (const message of messages) {
        const mine = message.senderId === ctx.user.uid;

        const bubble = document.createElement("div");
        bubble.className = `live-chat-bubble ${mine ? "mine" : "theirs"}`;

        const text = document.createElement("p");
        text.textContent = message.text || "";

        const time = document.createElement("small");
        const date = message.createdAt?.toDate?.();

        time.textContent = date
          ? date.toLocaleTimeString("en-PH", {
              hour: "numeric",
              minute: "2-digit"
            })
          : "Sending…";
bubble.append(text);

const attachment = message.attachment;

if (attachment?.type === "image") {
  let imageURL = "";

  try {
    const url = new URL(attachment.url);

    if (
      url.protocol === "https:" &&
      url.hostname === "res.cloudinary.com"
    ) {
      imageURL = url.href;
    }
  } catch {
    // Invalid image URLs are not rendered.
  }

  if (imageURL) {
    const link = document.createElement("a");
    link.href = imageURL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Open shared photo");

    const image = document.createElement("img");
    image.className = "chat-message-photo";
    image.src = imageURL;
    image.alt = attachment.name || "Shared photo";
    image.loading = "lazy";

    image.onerror = () => {
      link.textContent = "Photo unavailable";
      link.removeAttribute("href");
    };

    link.append(image);
    bubble.append(link);
  }
}

if (attachment?.type === "location") {
  const latitude = attachment.latitude;
  const longitude = attachment.longitude;

  const valid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180;

  if (valid) {
    const link = document.createElement("a");
    link.className = "chat-location-link";
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    link.href =
      "https://www.openstreetmap.org/" +
      `?mlat=${latitude}&mlon=${longitude}` +
      `#map=17/${latitude}/${longitude}`;

    link.textContent = "📍 Open shared location";

    bubble.append(link);

    if (Number.isFinite(attachment.accuracy)) {
      const accuracy = document.createElement("p");
      accuracy.textContent =
        `Estimated accuracy: ${Math.round(attachment.accuracy)} metres.`;
      accuracy.style.fontSize = "11px";
      bubble.append(accuracy);
    }
  }
}

bubble.append(time);
body.append(bubble);
      }

      if (nearBottom || sending) {
        body.scrollTop = body.scrollHeight;
      }
    },
    error => {
      console.error("Chat listener:", error);
      body.textContent =
        "Could not load messages. Check your connection and Firestore permissions.";
    }
  );

  async function sendMessage() {
    if (sending) return;

    const text = input.value.trim();
    if (!text) return;

    if (text.length > 2000) {
      showStatus("Please keep your message within 2,000 characters.");
      return;
    }

    sending = true;
    send.disabled = true;
    input.disabled = true;
    showStatus("Sending…");

    const senderName =
      ctx.profile?.displayName ||
      ctx.profile?.fullName ||
      ctx.user.displayName ||
      "User";

    try {
      const messageRef = doc(collection(db, "messages"));
      const notificationRef = doc(collection(db, "notifications"));

      // Both records save together, or neither saves.
      const batch = writeBatch(db);

      batch.set(messageRef, {
        conversationId,
        senderId: ctx.user.uid,
        receiverId: peerId,
        senderName,
        text,
        createdAt: serverTimestamp()
      });

      batch.set(notificationRef, {
        userId: peerId,
        senderId: ctx.user.uid,
        type: "message",
        title: `New message from ${senderName}`,
        message: text.slice(0, 160),
        messageId: messageRef.id,
        conversationId,
        read: false,
        createdAt: serverTimestamp()
      });

      await batch.commit();

      input.value = "";
      showStatus("");
      body.scrollTop = body.scrollHeight;
    } catch (error) {
      console.error("Send message:", error);

      showStatus(
        error.code === "permission-denied"
          ? "Message not sent. Firestore must allow the message and recipient notification."
          : "Message not sent. Please try again."
      );
    } finally {
      sending = false;
      send.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  send.addEventListener("click", sendMessage);

  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  });

  window.addEventListener("pagehide", () => {
    closed = true;
    stopMessages();
  }, { once: true });
}async function handleMessages(ctx) {
  const list = document.querySelector(".chat-list");
  const search = document.querySelector(".messages-search-bar input");
  const subtitle = document.querySelector(".unread-subtitle");
  const back = document.querySelector(".messages-header .back-btn-circle");

  if (!list) return;
const providerView = getReparoView(ctx) === "provider";
const isProvider = ctx.profile?.role === "provider";

const messagesNavigation = document.querySelector(
  ".messages-bottom-nav"
);

if (messagesNavigation && !providerView) {
  messagesNavigation.className = "bottom-nav";
  messagesNavigation.setAttribute("aria-label", "Main navigation");

  messagesNavigation.innerHTML = `
    <a href="index.html" class="nav-item">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
      </svg>
      <span>Home</span>
    </a>

    <a href="search.html" class="nav-item">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 14 15l.27.28v.79L20 21.5l1.5-1.5-6-6zM9.5 14a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/>
      </svg>
      <span>Search</span>
    </a>

    <a href="post.html" class="fab-btn" aria-label="Post a Request">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
      </svg>
    </a>

    <a href="mybooking.html" class="nav-item">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/>
      </svg>
      <span>Booking</span>
    </a>

    <a href="myprofile.html" class="nav-item">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
      <span>Profile</span>
    </a>
  `;
}
const inboxNavigation = {
  messagesNavHome: providerView
    ? "rm-index.html"
    : "index.html",

  messagesNavBooking: providerView
    ? "rm-booking.html"
    : "mybooking.html",

  messagesNavInbox: providerView
    ? "message.html?from=provider"
    : "message.html",

  messagesNavProfile: providerView
    ? "rm-profile.html"
    : "myprofile.html"
};
// Keep provider inbox navigation on provider pages.
const isProviderMessagesPage = providerView;

const bookingMenuLink = document.getElementById("messagesNavBooking");

if (bookingMenuLink) {
  bookingMenuLink.href = isProviderMessagesPage
    ? "rm-booking.html"
    : "mybooking.html";
}

for (const [id, destination] of Object.entries(inboxNavigation)) {
  const link = document.getElementById(id);

  if (link) {
    link.href = destination;
  }
}
  if (back) {
    back.href = providerView ? "rm-index.html" : "index.html";
    back.setAttribute("aria-label", "Back to home");
  }

  // Remove the unused compose button.
  const compose = document.querySelector(".compose-btn");
  if (compose) compose.hidden = true;

let records = [];
let loaded = false;
let bookingNamesReady = false;
let profileLoads = 0;
let closed = false;
let loadError = "";

  const names = new Map();
  const requestedProfiles = new Set();

  list.textContent = "Loading conversations…";
  list.setAttribute("aria-busy", "true");

  function makeElement(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function messageTime(message) {
    return message.createdAt?.toMillis?.() || 0;
  }

  function previewText(message) {
    const attachment = message.attachment;

    if (attachment?.type === "image") {
      return "Photo";
    }

    if (attachment?.type === "location") {
      return "Shared location";
    }

    return message.text || "Message";
  }

  function renderInbox() {
    if (closed) return;

    if (loadError) {
      list.textContent = loadError;
      return;
    }

if (!loaded || !bookingNamesReady || profileLoads > 0) return;

list.setAttribute("aria-busy", "false");

    const latestByPerson = new Map();

    // Explicitly sort before grouping so each person keeps their newest message.
    const sorted = [...records].sort(
      (a, b) => messageTime(a) - messageTime(b)
    );

    for (const message of sorted) {
      const peerId =
        message.senderId === ctx.user.uid
          ? message.receiverId
          : message.senderId;

      if (!peerId || peerId === ctx.user.uid) continue;

      latestByPerson.set(peerId, message);
    }

    const conversations = [...latestByPerson.entries()].sort(
      (a, b) => messageTime(b[1]) - messageTime(a[1])
    );

    if (subtitle) {
      const count = conversations.length;
      subtitle.textContent =
        `${count} conversation${count === 1 ? "" : "s"}`;
    }

    const term = (search?.value || "").trim().toLowerCase();
    const content = document.createDocumentFragment();
    let displayed = 0;

    for (const [peerId, message] of conversations) {
     const name =
  peerId === "KKutxcZ55YSls3WKMuvfgvMZjKA3"
    ? "CHAT SUPPORT"
    : names.get(peerId) || "Conversation";
      const preview = previewText(message);

      if (
        term &&
        !`${name} ${preview} ${peerId}`.toLowerCase().includes(term)
      ) {
        continue;
      }

      const params = new URLSearchParams({
        with: peerId,
        back: "messages"
      });

      if (providerView) {
        params.set("from", "provider");
      }

      const link = makeElement("a", "inbox-conversation");
      link.href = `chat.html?${params.toString()}`;

      const avatar = makeElement(
        "span",
        "inbox-avatar",
        name.charAt(0).toUpperCase()
      );

      avatar.setAttribute("aria-hidden", "true");

      const info = makeElement("div", "inbox-info");
      const top = makeElement("div", "inbox-row");
      const title = makeElement("h2", "", name);

      top.append(title);

      const timestamp = messageTime(message);

      if (timestamp) {
        const date = new Date(timestamp);
        const time = makeElement(
          "time",
          "inbox-time",
          date.toLocaleDateString("en-PH", {
            month: "short",
            day: "numeric"
          })
        );

        time.dateTime = date.toISOString();
        time.title = date.toLocaleString("en-PH");
        top.append(time);
      }

      const prefix =
        message.senderId === ctx.user.uid ? "You: " : "";

      info.append(
        top,
        makeElement("p", "inbox-preview", prefix + preview)
      );

      link.append(avatar, info);
      content.append(link);
      displayed++;
    }

    if (!displayed) {
      content.append(
        makeElement(
          "p",
          "inbox-empty",
          term
            ? "No matching conversations."
            : "No conversations yet. Messages you send or receive will appear here."
        )
      );
    }

    list.replaceChildren(content);
  }

  // Provider rules permit reading their bookings, which contain customer names.
  // This avoids trying to read private customer profile documents.
  const stopBookingNames = onSnapshot(
    query(
      collection(db, "bookings"),
      where(
        isProvider ? "providerId" : "customerId",
        "==",
        ctx.user.uid
      )
    ),
    snapshot => {
      if (closed) return;

      snapshot.forEach(item => {
        const booking = item.data();

        const peerId = isProvider
          ? booking.customerId
          : booking.providerId;

        const name = isProvider
          ? booking.customerName
          : booking.providerName;

        if (peerId && typeof name === "string" && name.trim()) {
          names.set(peerId, name.trim());
        }
      });

      bookingNamesReady = true;
      renderInbox();
    },
    error => {
      console.warn("Booking names unavailable:", error.code);
      bookingNamesReady = true;
      renderInbox();
    }
  );

  const stopMessages = watchMyMessages(
    ctx.user.uid,

    messages => {
      if (closed) return;

      records = messages;
      loaded = true;
      loadError = "";
      list.setAttribute("aria-busy", "false");

      for (const message of messages) {
        const peerId =
          message.senderId === ctx.user.uid
            ? message.receiverId
            : message.senderId;

        if (!peerId || peerId === ctx.user.uid) continue;

        if (
          message.senderId === peerId &&
          typeof message.senderName === "string" &&
          message.senderName.trim()
        ) {
          names.set(peerId, message.senderName.trim());
        }

        // Customers may read provider profiles under your existing rules.
        // Providers use senderName / booking.customerName instead.
        if (
          !isProvider &&
          !names.has(peerId) &&
          !requestedProfiles.has(peerId)
        ) {
          requestedProfiles.add(peerId);
          profileLoads++;

          getUserProfile(peerId)
            .then(profile => {
              if (closed) return;

              const name = profile?.displayName || profile?.fullName;

              if (name) {
                names.set(peerId, name);
                renderInbox();
              }
            })
            .catch(error => {
              console.warn("Conversation name unavailable:", error.code);
            })
            .finally(() => {
              profileLoads--;
              renderInbox();
            });
        }
      }

      renderInbox();
    },

    error => {
      if (closed) return;

      console.error("Inbox listener:", error);
  

      loadError =
        error.code === "permission-denied"
          ? "Unable to read messages. Check that your Firestore rules allow the sender and recipient to read their messages."
          : "Unable to load conversations. Check your connection and reload.";

      renderInbox();
    }
  );

  search?.addEventListener("input", renderInbox);

  window.addEventListener("pagehide", () => {
    closed = true;
    stopMessages();
    stopBookingNames();
    search?.removeEventListener("input", renderInbox);
  }, { once: true });

  window.addEventListener("pageshow", event => {
    if (event.persisted) location.reload();
  }, { once: true });

}function startLiveNotifications(ctx) {
  if (location.pathname.split("/").pop() === "rm-index.html") {
    return;
  }
  const isAdmin = ctx.profile.role === "admin";

  const bell = document.querySelector(
    isAdmin
      ? ".notification-circle"
      : 'a[href="notification.html"]'
  );

  if (!bell) return;

  // Prevent duplicate panels.
  document.getElementById("floatingNotifications")?.remove();

  let badge = bell.querySelector(".badge, .notification-badge");

  if (!badge) {
    badge = document.createElement("span");
    badge.className = isAdmin ? "badge" : "notification-badge";
    bell.appendChild(badge);
  }

  badge.hidden = true;

  const panel = document.createElement("section");
  panel.id = "floatingNotifications";
  panel.className = "floating-notifications";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Notifications");

  panel.innerHTML = `
    <div class="floating-notif-header">
      <div>
        <h3>Notifications</h3>
        <p class="floating-notif-count">Connecting…</p>
      </div>

      <div class="floating-notif-actions">
        <button type="button" class="floating-mark-read">
          Mark all read
        </button>
        <button type="button" class="floating-notif-close"
          aria-label="Close notifications">×</button>
      </div>
    </div>

    <div class="floating-notif-tabs">
      <button type="button" class="active" data-filter="all">All</button>
      <button type="button" data-filter="messages">Messages</button>
      <button type="button" data-filter="booking">Booking</button>
      <button type="button" data-filter="application">Application</button>
    </div>

    <div class="floating-notif-list" aria-live="polite"></div>
  `;

  document.body.appendChild(panel);

  const list = panel.querySelector(".floating-notif-list");
  const countLabel = panel.querySelector(".floating-notif-count");
  const markAll = panel.querySelector(".floating-mark-read");

  let filter = "all";
  let personal = [];
  let applications = [];
  let adminReads = {};
  let personalReady = false;
  let applicationsReady = !isAdmin;
  let readsReady = !isAdmin;
  let previousKeys = null;

  const errors = new Set();
  const stops = [];

  function milliseconds(value) {
    if (value?.toMillis) return value.toMillis();
    if (value?.seconds) return value.seconds * 1000;

    const result = value ? new Date(value).getTime() : 0;
    return Number.isFinite(result) ? result : 0;
  }

  function category(type) {
    const value = String(type || "").toLowerCase();

    if (/application|provider/.test(value)) return "application";
    if (/message|chat/.test(value)) return "messages";
    if (/book/.test(value)) return "booking";

    return "other";
  }

  function allItems() {
    const applicantAlerts = applications.map(application => {
      const version = milliseconds(application.submittedAt);

      return {
        key: `application:${application.id}`,
        id: application.id,
        source: "application",
        version,
        type: "application",
        title: "New provider application",
        message:
          `${application.fullName || application.email || "A provider"} ` +
          "submitted an application." +
          (application.serviceCategory
            ? ` Service: ${application.serviceCategory}.`
            : "") +
          (application.location
            ? ` Location: ${application.location}.`
            : ""),
        createdAt: application.submittedAt,
        read: adminReads[application.id] === version
      };
    });

    return [
      ...personal.map(item => ({
        ...item,
        key: `notification:${item.id}`,
        source: "notification"
      })),
      ...applicantAlerts
    ].sort((a, b) =>
      milliseconds(b.createdAt) - milliseconds(a.createdAt)
    );
  }

  function destination(item) {
    if (item.source === "application") {
      return {
        href:
          "view-permit.html?application=" +
          encodeURIComponent(item.id),
        label: "Review application"
      };
    }

    if (item.link === "rm-index.html") {
      return {
        href: "rm-index.html",
        label: "Open provider dashboard"
      };
    }

    if (category(item.type) === "messages") {
      return {
        href: isAdmin ? "admin-support.html" : "message.html",
        label: "Open messages"
      };
    }

    if (!isAdmin && category(item.type) === "booking") {
      return {
        href: ctx.profile.role === "provider"
          ? "rm-booking.html"
          : "mybooking.html",
        label: "View booking"
      };
    }

    return null;
  }

  async function markRead(items) {
    const unread = items.filter(item => !item.read);

    // Small batches also support large notification histories.
    for (let start = 0; start < unread.length; start += 400) {
      const batch = writeBatch(db);
      const readUpdates = {};

      unread.slice(start, start + 400).forEach(item => {
        if (item.source === "application") {
          readUpdates[item.id] = item.version;
        } else {
          batch.update(doc(db, "notifications", item.id), {
            read: true
          });
        }
      });

      // Keep admin read state in Firestore, separately from approval.
      if (Object.keys(readUpdates).length) {
        batch.set(
          doc(db, "users", ctx.user.uid),
          { adminNotificationReads: readUpdates },
          { merge: true }
        );
      }

      await batch.commit();
    }
  }

  const iconPaths = {
    application:
      "M12 2L3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4zm-1 14l-4-4 1.4-1.4 2.6 2.6 5.6-5.6L18 9l-7 7z",
    messages:
      "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM4 17V4h16v12H5l-1 1z",
    booking:
      "M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z",
    other:
      "M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
  };

  function render() {
    const items = allItems();
    const ready = personalReady && applicationsReady && readsReady;
    const unread = items.filter(item => !item.read).length;

    badge.textContent = unread ? String(unread) : "";
    badge.hidden = !ready || unread === 0 || errors.size > 0;
    badge.style.display = badge.hidden ? "none" : "inline-flex";

    countLabel.textContent = errors.size
      ? "Some updates are unavailable. Refresh to retry."
      : !ready
        ? "Connecting…"
        : `${unread} unread notification${unread === 1 ? "" : "s"}`;

    markAll.disabled = !ready || unread === 0 || errors.size > 0;

    // Preserve expanded cards while live updates arrive.
    const expanded = new Set(
      [...list.querySelectorAll("details[open]")]
        .map(element => element.dataset.key)
    );

    list.replaceChildren();

    const visible = items.filter(item =>
      filter === "all" || category(item.type) === filter
    );

    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "floating-notif-empty";
      empty.textContent = errors.size
        ? "Unable to load all notifications."
        : !ready
          ? "Connecting to your notifications…"
          : "No notifications here yet.";

      list.appendChild(empty);
      return;
    }

    visible.forEach(item => {
      const group = category(item.type);
      const card = document.createElement("details");

      card.className = `floating-notif-card ${item.read ? "" : "unread"}`;
      card.dataset.key = item.key;
      card.open = expanded.has(item.key);

      // Static layout only; database text is assigned below.
      card.innerHTML = `
        <summary>
          <span class="floating-notif-icon ${group}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="${iconPaths[group] || iconPaths.other}"></path>
            </svg>
          </span>

          <span class="floating-notif-text">
            <strong></strong>
            <span class="floating-notif-preview"></span>
            <small></small>
          </span>

          ${item.read ? "" : '<span class="floating-unread-dot"></span>'}
        </summary>

        <div class="floating-notif-detail">
          <p></p>
        </div>
      `;

      card.querySelector("strong").textContent = item.title || "Update";
      card.querySelector(".floating-notif-preview").textContent =
        item.message || "";
      card.querySelector(".floating-notif-detail p").textContent =
        item.message || "";

      const time = milliseconds(item.createdAt);

      card.querySelector("small").textContent = time
        ? new Date(time).toLocaleString("en-PH", {
            timeZone: "Asia/Manila",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
          })
        : "Just now";

      const target = destination(item);

      if (target) {
        const link = document.createElement("a");
        link.href = target.href;
        link.className = "floating-notif-link";
        link.textContent = target.label;
        card.querySelector(".floating-notif-detail").appendChild(link);
      }

      card.querySelector("summary").addEventListener("click", () => {
        if (!card.open && !item.read) {
          markRead([item]).catch(error => {
            console.error(error);
            flash("Could not mark notification as read.", "error");
          });
        }
      });

      list.appendChild(card);
    });
  }

function positionPanel() {
  const bounds = bell.getBoundingClientRect();
  const gap = 12;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;

  const width = Math.min(380, viewportWidth - gap * 2);

  // Keep both edges inside the screen.
  const left = Math.max(
    gap,
    Math.min(
      bounds.right - width,
      viewportWidth - width - gap
    )
  );

  const top = Math.max(
    gap,
    Math.min(bounds.bottom + 10, viewportHeight - 220)
  );

  panel.style.position = "fixed";
  panel.style.width = `${width}px`;
  panel.style.left = `${left}px`;
  panel.style.right = "auto";
  panel.style.top = `${top}px`;
  panel.style.bottom = "auto";
  panel.style.maxHeight = `${Math.max(0, viewportHeight - top - gap)}px`;
}
  function closePanel() {
    panel.hidden = true;
    bell.setAttribute("aria-expanded", "false");
  }

  // Capture prevents the old bell navigation handler from running.
  bell.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();

    panel.hidden = !panel.hidden;
    bell.setAttribute("aria-expanded", String(!panel.hidden));

    if (!panel.hidden) positionPanel();
  }, true);

  bell.setAttribute("role", "button");
  bell.setAttribute("tabindex", "0");
  bell.setAttribute("aria-controls", panel.id);
  bell.setAttribute("aria-expanded", "false");

  bell.addEventListener("keydown", event => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      bell.click();
    }
  }, true);

  panel.querySelector(".floating-notif-close")
    .addEventListener("click", closePanel);

  document.addEventListener("click", event => {
    if (!bell.contains(event.target) && !panel.contains(event.target)) {
      closePanel();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) {
      closePanel();
      bell.focus();
    }
  });

  panel.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
      filter = button.dataset.filter;

      panel.querySelectorAll("[data-filter]").forEach(tab => {
        tab.classList.toggle("active", tab === button);
      });

      render();
    });
  });

  markAll.addEventListener("click", async () => {
    markAll.disabled = true;

    try {
      await markRead(allItems());
    } catch (error) {
      console.error(error);
      flash("Could not mark all notifications as read.", "error");
    } finally {
      render();
    }
  });

  function failed(source, error) {
    console.error(source, error);
    errors.add(source);
    render();
  }

  render();

  stops.push(onSnapshot(
    query(
      collection(db, "notifications"),
      where("userId", "==", ctx.user.uid)
    ),
    snapshot => {
      personal = snapshot.docs.map(item => ({
        ...item.data(),
        id: item.id
      }));
      personalReady = true;
      render();
    },
    error => failed("notifications", error)
  ));

  if (isAdmin) {
    stops.push(onSnapshot(
      query(
        collection(db, "providerApplications"),
        where("status", "==", "pending")
      ),
      snapshot => {
        applications = snapshot.docs.map(item => ({
          ...item.data(),
          id: item.id
        }));
        applicationsReady = true;
        render();
      },
      error => failed("applications", error)
    ));

    stops.push(onSnapshot(
      doc(db, "users", ctx.user.uid),
      snapshot => {
        adminReads = snapshot.data()?.adminNotificationReads || {};
        readsReady = true;
        render();
      },
      error => failed("read status", error)
    ));
  }

  window.addEventListener("resize", positionPanel);

  window.addEventListener("pagehide", () => {
    stops.forEach(stop => stop());
    window.removeEventListener("resize", positionPanel);
    panel.remove();
  }, { once: true });
}
function startAdminSearch(ctx) {
  if (ctx.profile.role !== "admin") return;

  const input = document.querySelector(".search-bar-box input");
  const wrapper = input?.closest(".search-bar-box");

  if (!input || !wrapper || wrapper.dataset.searchReady) return;

  wrapper.dataset.searchReady = "true";
  wrapper.style.position = "relative";

  input.placeholder = "Search users or applications…";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Search users and applications");
  input.setAttribute("aria-controls", "adminSearchResults");

  const results = document.createElement("div");
  results.id = "adminSearchResults";
  results.className = "admin-search-results";
  results.hidden = true;
  results.setAttribute("aria-live", "polite");

  wrapper.appendChild(results);

  let users = [];
  let applications = [];
  let usersReady = false;
  let applicationsReady = false;
  let started = false;

  const errors = new Set();
  const stops = [];

  function message(text) {
    const paragraph = document.createElement("p");
    paragraph.className = "admin-search-message";
    paragraph.textContent = text;
    results.appendChild(paragraph);
  }

  function render() {
    const value = input.value.trim().toLowerCase();
    results.replaceChildren();

    if (!value) {
      results.hidden = true;
      return;
    }

    results.hidden = false;

    if (!usersReady || !applicationsReady) {
      message(
        errors.size
          ? "Some records could not load. Refresh to retry."
          : "Searching records…"
      );
    }

    const records = [
      ...users.map(user => ({
        kind: "user",
        id: user.id,
        title: user.displayName || user.fullName || user.email || "User",
        subtitle: [
          user.role || "user",
          user.email,
          user.serviceCategory,
          user.location
        ].filter(Boolean).join(" · "),
        user
      })),

      ...applications.map(application => ({
        kind: "application",
        id: application.id,
        title:
          application.fullName ||
          application.email ||
          "Provider application",
        subtitle: [
          "Application",
          application.status,
          application.email,
          application.serviceCategory,
          application.location
        ].filter(Boolean).join(" · ")
      }))
    ];

    const terms = value.split(/\s+/);

    const matches = records.filter(record => {
      const text =
        `${record.title} ${record.subtitle} ${record.id}`.toLowerCase();

      return terms.every(term => text.includes(term));
    });

    if (!matches.length) {
      if (usersReady && applicationsReady && !errors.size) {
        message("No matching users or applications.");
      }
      return;
    }

    message(
      `${matches.length} result${matches.length === 1 ? "" : "s"}` +
      (matches.length > 12 ? " — showing the first 12" : "")
    );

    matches.slice(0, 12).forEach(record => {
      if (record.kind === "application") {
        const link = document.createElement("a");
        link.className = "admin-search-result";
        link.href =
          "view-permit.html?application=" +
          encodeURIComponent(record.id);

        const title = document.createElement("strong");
        title.textContent = record.title;

        const description = document.createElement("span");
        description.textContent = record.subtitle;

        link.append(title, description);
        results.appendChild(link);
      } else {
        // Clicking a user result expands the real profile information.
        const detail = document.createElement("details");
        detail.className = "admin-search-result";

        const summary = document.createElement("summary");

        const title = document.createElement("strong");
        title.textContent = record.title;

        const description = document.createElement("span");
        description.textContent = record.subtitle;

        summary.append(title, description);

        const information = document.createElement("div");
        information.className = "admin-search-profile";

        [
          ["Email", record.user.email],
          ["Role", record.user.role],
          ["Service", record.user.serviceCategory],
          ["Location", record.user.location],
          ["Contact", record.user.contactNumber]
        ].forEach(([label, value]) => {
          if (!value) return;

          const paragraph = document.createElement("p");
          paragraph.textContent = `${label}: ${value}`;
          information.appendChild(paragraph);
        });

        detail.append(summary, information);
        results.appendChild(detail);
      }
    });
  }

  function startListeners() {
    if (started) return;
    started = true;

    stops.push(onSnapshot(
      collection(db, "users"),
      snapshot => {
        users = snapshot.docs.map(item => ({
          ...item.data(),
          id: item.id
        }));
        usersReady = true;
        render();
      },
      error => {
        console.error("User search:", error);
        errors.add("users");
        render();
      }
    ));

    stops.push(onSnapshot(
      collection(db, "providerApplications"),
      snapshot => {
        applications = snapshot.docs.map(item => ({
          ...item.data(),
          id: item.id
        }));
        applicationsReady = true;
        render();
      },
      error => {
        console.error("Application search:", error);
        errors.add("applications");
        render();
      }
    ));
  }

  input.addEventListener("input", () => {
    if (input.value.trim()) startListeners();
    render();
  });

  input.addEventListener("focus", () => {
    if (input.value.trim()) {
      startListeners();
      render();
    }
  });

  input.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      results.hidden = true;
    }

    if (["Enter", "ArrowDown"].includes(event.key)) {
      event.preventDefault();

      const first = results.querySelector("a, summary");
      if (first) first.focus();
    }
  });

  document.addEventListener("click", event => {
    if (!wrapper.contains(event.target)) {
      results.hidden = true;
    }
  });

  results.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      results.hidden = true;
      input.focus();
    }
  });

  window.addEventListener("pagehide", () => {
    stops.forEach(stop => stop());
  }, { once: true });
}
async function handleAdminApprovals(ctx) {
 const approvalTable = document.querySelector(".approval-table");

if (!approvalTable) {
  console.error("Provider approval table was not found.");
  return;
}

const table =
  approvalTable.tBodies[0] || approvalTable.createTBody();

  const tabs = document.querySelectorAll(".tab-btn[data-filter]");
  let applications = [];
  let selectedFilter = "all";

  function showMessage(message) {
    table.replaceChildren();

    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 7;
    cell.textContent = message;

    row.appendChild(cell);
    table.appendChild(row);
  }

  function milliseconds(value) {
    if (value?.toMillis) return value.toMillis();

    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.getTime()
      : 0;
  }

  function displayDate(value) {
    if (!value) return "Not provided";

    // Preserve dates entered without a time.
    if (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      return value;
    }

    const date = value?.toDate ? value.toDate() : new Date(value);

    if (Number.isNaN(date.getTime())) return "Invalid date";

    return date.toLocaleDateString("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function textCell(value) {
    const cell = document.createElement("td");
    cell.textContent = value || "Not provided";
    return cell;
  }

  function render() {
    tabs.forEach(tab => {
      const filter = tab.dataset.filter;
      const count = filter === "all"
        ? applications.length
        : applications.filter(item => item.status === filter).length;

      const label = filter === "all"
        ? "ALL"
        : filter.charAt(0).toUpperCase() + filter.slice(1);

      tab.textContent = `${label} (${count})`;
      tab.classList.toggle("active", filter === selectedFilter);
    });

    const visible = applications.filter(item =>
      selectedFilter === "all" || item.status === selectedFilter
    );

    if (!visible.length) {
      showMessage("No applications in this category.");
      return;
    }

    table.replaceChildren();

    visible.forEach(application => {
      const row = document.createElement("tr");
      row.dataset.status = application.status || "";

      // 1. Provider
      const providerCell = document.createElement("td");
      const provider = document.createElement("div");
      provider.className = "provider-cell";

      const info = document.createElement("div");
      info.className = "provider-info";

      const name = document.createElement("strong");
      name.textContent =
        application.fullName ||
        application.email ||
        "Name not provided";

      const email = document.createElement("span");
      email.textContent = application.email || "";

      info.append(name, email);
      provider.appendChild(info);
      providerCell.appendChild(provider);

      // 6. Status
      const statusCell = document.createElement("td");
      const badge = document.createElement("span");

      const status = ["pending", "approved", "declined"]
        .includes(application.status)
        ? application.status
        : "unknown";

      badge.className = `status-badge ${status}`;
      badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      statusCell.appendChild(badge);

      // 7. Action
      const actionCell = document.createElement("td");
      const link = document.createElement("a");

      link.className = "btn-permit";
      link.textContent = "View Permit";
      link.href =
        "view-permit.html?application=" +
        encodeURIComponent(application.id);

      actionCell.appendChild(link);

      row.append(
        providerCell,
        textCell(application.serviceCategory),
        textCell(application.location),
        textCell(displayDate(application.submittedAt)),
        textCell(displayDate(application.permitExpiry)),
        statusCell,
        actionCell
      );

      table.appendChild(row);
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      selectedFilter = tab.dataset.filter;
      render();
    });
  });

  const dateLabel = document.querySelector(".header-title p");

  if (dateLabel) {
    dateLabel.textContent = new Date().toLocaleDateString("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  tabs.forEach(tab => {
    const filter = tab.dataset.filter;
    tab.textContent = filter === "all"
      ? "ALL"
      : filter.charAt(0).toUpperCase() + filter.slice(1);
  });

  showMessage("Connecting to Firestore…");

  const stop = onSnapshot(
    collection(db, "providerApplications"),
    snapshot => {
      applications = snapshot.docs
        .map(item => ({
          ...item.data(),
          id: item.id
        }))
        .sort((a, b) =>
          milliseconds(b.submittedAt) - milliseconds(a.submittedAt)
        );

      render();
    },
    error => {
      console.error("Provider applications:", error);

      showMessage(
        `Cannot load applications: ${error.code || error.message}.`
      );
    }
  );

  window.addEventListener("pagehide", stop, { once: true });
}function startHomeIdentityAndMap(ctx) {
  const dialog = document.getElementById("homeLocationDialog");
  const locationText = document.getElementById("homeLocationText");
  const status = document.getElementById("homeMapStatus");
  const locationButton = document.querySelector(
    'button[aria-label="Location"]'
  );

  if (!dialog || !locationText || !status) return;

  let map;
  let marker;
  let accuracyCircle;
  let latestPosition = null;
  let watchId = null;
  let addressBusy = false;
let lastAddressPoint = null;
let lastAddressAttempt = 0;

async function displayPlaceName(latitude, longitude) {
  const now = Date.now();

  if (addressBusy || now - lastAddressAttempt < 30000) return;

  if (lastAddressPoint) {
    const distance = Math.hypot(
      (latitude - lastAddressPoint.latitude) * 111320,
      (longitude - lastAddressPoint.longitude) *
        111320 * Math.cos(latitude * Math.PI / 180)
    );

    if (distance < 150) return;
  }

  addressBusy = true;
  lastAddressAttempt = now;
  locationText.textContent = "Finding location name…";

  try {
    const url = new URL(
      "https://api.bigdatacloud.net/data/reverse-geocode-client"
    );

    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("localityLanguage", "en");

    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Address lookup failed (${response.status})`);
    }

    const data = await response.json();

    // Show the locality and region name without "(Region V)".
    const parts = [
      data.locality || data.city,
      data.principalSubdivision
    ]
      .filter(value => typeof value === "string")
      .map(value => value.trim())
      .filter(Boolean);

    const placeName = [...new Set(parts)].join(", ");

    if (!placeName) {
      throw new Error("No location name was returned");
    }

    locationText.textContent = placeName;

    if (status) {
      status.textContent = `Detected area: ${placeName}`;
    }

    lastAddressPoint = { latitude, longitude };
  } catch (error) {
    console.error("Location name lookup failed:", error);

    locationText.textContent = "Location name unavailable";

    if (status) {
      status.textContent =
        "Your position was detected, but its address could not be loaded.";
    }
  } finally {
    addressBusy = false;
  }
}

  // Only update the logged-in person's header and drawer.
  const stopProfile = onSnapshot(
    doc(db, "users", ctx.user.uid),
    snapshot => {
      const profile = snapshot.data() || {};
      const name =
        profile.displayName ||
        profile.fullName ||
        ctx.user.displayName ||
        "Name not provided";

      document.querySelectorAll(
        ".greeting-text .profile-fullname, #sideDrawer .profile-fullname"
      ).forEach(element => {
        element.textContent = name;
      });
    },
    error => {
      console.error("Homepage profile:", error);
      document.querySelectorAll(
        ".greeting-text .profile-fullname, #sideDrawer .profile-fullname"
      ).forEach(element => {
        element.textContent = "Unable to load name";
      });
    }
  );

  function drawPosition(center = false) {
    if (!map || !latestPosition) return;

    const { latitude, longitude, accuracy } = latestPosition;
    const point = [latitude, longitude];

    if (!marker) {
      // A circle marker needs no marker-icon.png files.
      marker = L.circleMarker(point, {
        radius: 9,
        color: "#ffffff",
        weight: 3,
        fillColor: "#089f8f",
        fillOpacity: 1
      }).addTo(map);

      marker.bindPopup("Your current device location");

      accuracyCircle = L.circle(point, {
        radius: accuracy,
        color: "#089f8f",
        weight: 1,
        fillOpacity: 0.12
      }).addTo(map);

      center = true;
    } else {
      marker.setLatLng(point);
      accuracyCircle.setLatLng(point);
      accuracyCircle.setRadius(accuracy);
    }

    if (center) map.setView(point, 16);
  }

  function startLocation() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    if (!navigator.geolocation) {
      locationText.textContent = "Location is not supported";
      status.textContent = "This browser cannot detect your location.";
      return;
    }

    locationText.textContent = "Detecting your location…";
    status.textContent = "Waiting for your device location…";

    watchId = navigator.geolocation.watchPosition(
      position => {
        latestPosition = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
const { latitude, longitude } = latestPosition;

// Keep coordinates internally for the map.
drawPosition();

// Display a readable place name.
void displayPlaceName(latitude, longitude);
      },
      error => {
        const message = error.code === 1
          ? "Allow location access in your browser to detect your location."
          : "Location is currently unavailable. Tap Locate me to retry.";

        locationText.textContent = "Location unavailable";
        status.textContent = message;

        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000
      }
    );
  }

  locationButton?.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();

    if (!window.L) {
      status.textContent = "Map files could not load. Check your connection.";
      return;
    }

    if (!map) {
      map = L.map("homeLiveMap", {
        dragging: true,
        touchZoom: true,
        scrollWheelZoom: true,
        zoomControl: true
      }).setView([0, 0], 2);

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">' +
          "OpenStreetMap</a> contributors"
      }).addTo(map);
    }

    requestAnimationFrame(() => {
      map.invalidateSize();
      drawPosition(true);
    });

    if (watchId === null) startLocation();
  });

  document.getElementById("closeHomeMap")
    ?.addEventListener("click", () => dialog.close());

  document.getElementById("locateHomeAgain")
    ?.addEventListener("click", () => {
      drawPosition(true);
      startLocation();
    });

  // Start detecting after this signed-in homepage initializes.
  startLocation();

  window.addEventListener("pagehide", () => {
    stopProfile();

    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }

    map?.remove();
  }, { once: true });
}function getReparoView(ctx) {
  const approvedProvider = ctx.profile?.role === "provider";

  if (!approvedProvider) return "customer";

  const currentPage =
    location.pathname.split("/").pop() || "index.html";

  // Provider pages always use provider navigation.
  if (currentPage.startsWith("rm-")) {
    return "provider";
  }

  // Customer pages always use customer navigation.
  const customerPages = [
    "index.html",
    "myprofile.html",
    "mybooking.html",
    "settings.html",
    "search.html",
    "search-results.html",
    "service.html",
    "book-repair.html",
    "post.html",
    "web-rate.html"
  ];

  if (customerPages.includes(currentPage)) {
    return "customer";
  }

  // Shared pages: Messages, Chat and Notifications.
  const from = new URLSearchParams(location.search).get("from");

  if (from === "provider" || from === "customer") {
    return from;
  }

  try {
    const previous = new URL(document.referrer);

    if (previous.origin === location.origin) {
      const previousPage = previous.pathname.split("/").pop();

      if (previousPage.startsWith("rm-")) return "provider";
      if (customerPages.includes(previousPage)) return "customer";
    }
  } catch {
    // No usable referring page.
  }

  try {
    return sessionStorage.getItem(`reparo-view:${ctx.user.uid}`) === "provider"
      ? "provider"
      : "customer";
  } catch {
    return "customer";
  }
}

function installAccountSwitch(ctx) {
  const currentPage =
    location.pathname.split("/").pop() || "index.html";

  const originalProviderLinks = [
    ...document.querySelectorAll('a[href="be-provider.html"]')
  ].map(link => ({
    link,
    html: link.innerHTML,
    href: link.getAttribute("href")
  }));

  let switchLink = null;

  // Add a return-to-provider icon beside the customer's notification bell.
  if (["index.html", "search.html"].includes(currentPage)) {
  const actions = document.querySelector(".header-actions");

    if (actions) {
      switchLink = document.createElement("a");
      switchLink.id = "customerProviderSwitch";
      switchLink.className = "account-switch-icon";
      switchLink.href = "rm-index.html";
      switchLink.hidden = true;
      switchLink.title = "Switch to provider";
      switchLink.setAttribute("aria-label", "Switch to provider");

      switchLink.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16m-4-4 4 4-4 4"/>
          <path d="M20 17H4m4-4-4 4 4 4"/>
        </svg>
      `;

      actions.append(switchLink);
    }
  }

  function renderSwitches() {
    const approvedProvider = ctx.profile?.role === "provider";

    if (switchLink) {
      switchLink.hidden = !approvedProvider;
    }

    for (const original of originalProviderLinks) {
      const link = original.link;

      // Restore the normal application link for non-provider accounts.
      link.innerHTML = original.html;
      link.setAttribute("href", original.href);

      if (!approvedProvider) continue;

      link.href = "rm-index.html";
      link.setAttribute("aria-label", "Switch to provider");

      const promo = link.querySelector(".promo-copy");

      if (promo) {
        promo.querySelector("small").textContent = "PROVIDER WORKSPACE";
        promo.querySelector("strong").textContent = "Switch to Provider";

        const description = promo.querySelector(":scope > span:not(.promo-action)");

        if (description) {
          description.textContent =
            "Manage your customer bookings, messages, and services.";
        }

        const action = promo.querySelector(".promo-action");

        if (action) {
          action.textContent = "Open dashboard →";
        }
      } else {
        // Profile button and side-menu entry: preserve their icons.
        const label = link.querySelector(":scope > span:not(.menu-icon)")

        if (label) {
          label.textContent = "Switch to Provider";
        } else {
          link.textContent = "Switch to Provider";
        }
      }
    }

    try {
      sessionStorage.setItem(
        `reparo-view:${ctx.user.uid}`,
        getReparoView(ctx)
      );
    } catch {
      
      // Navigation still works without session storage.
    }
    document.documentElement.dataset.roleUiReady = "true";
  }

  renderSwitches();

  // Reflect admin approval changes while the page is open.
  const stop = onSnapshot(
    doc(db, "users", ctx.user.uid),
    snapshot => {
      if (!snapshot.exists()) return;

      ctx.profile = {
        ...ctx.profile,
        ...snapshot.data()
      };

      renderSwitches();
    },
    error => {
      console.error("Account switch:", error);
    }
  );

  // Carry the current view into shared pages.
  function preserveView(event) {
    const link = event.target.closest?.("a[href]");
    if (!link) return;

    const destination = new URL(link.href, location.href);

    if (destination.origin !== location.origin) return;

    const targetPage = destination.pathname.split("/").pop();

    if (
      ["message.html", "chat.html", "notification.html"].includes(targetPage)
    ) {
      destination.searchParams.set("from", getReparoView(ctx));
      link.href = destination.href;
    }
  }

  document.addEventListener("click", preserveView, true);

  window.addEventListener("pagehide", () => {
    stop();
    document.removeEventListener("click", preserveView, true);
  }, { once: true });
}function startNearbyProviders(ctx, isResultsPage = false) {
  const list = document.getElementById(
    isResultsPage ? "providerResultsList" : "nearbyProviders"
  );

  const status = document.getElementById("nearbyStatus");
  const retry = document.getElementById("nearbyRetry");

  if (!list || !status) return;

  const RADIUS_KM = 10;
  const HOME_LIMIT = 4;

  const searchInput = isResultsPage
    ? document.querySelector(".search-input-wrapper input")
    : null;
    const selectedCategory = isResultsPage
  ? new URLSearchParams(location.search).get("q")?.trim() || ""
  : "";

if (searchInput) {
  // An empty q means See all: clear any previous category.
  searchInput.value = selectedCategory;
}

  const count = isResultsPage
    ? document.querySelector(".results-count")
    : null;

  const sortButtons = isResultsPage
    ? [...document.querySelectorAll("[data-sort]")]
    : [];

  list.classList.add("nearby-list");

let providers = [];
let loaded = false;
let serverConfirmed = false;
let databaseError = "";
  let locationError = "";
  let position = null;
  let watchId = null;
  let sortBy = isResultsPage ? "nearest" : "rating";
  let closed = false;

  let map = null;
  let markers = null;
  let customerMarker = null;
  let accuracyCircle = null;
  let mapCentered = false;

  function numeric(value) {
    if (
      value === null ||
      value === undefined ||
      typeof value === "boolean" ||
      String(value).trim() === ""
    ) {
      return null;
    }

    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function coordinates(provider) {
    const lat = numeric(provider.latitude);
    const lng = numeric(provider.longitude);

    if (
      lat === null ||
      lng === null ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return null;
    }

    return [lat, lng];
  }

  function ratingOf(provider) {
    const value = numeric(provider.averageRating ?? provider.rating);

    return value !== null && value > 0 && value <= 5
      ? value
      : null;
  }

  function priceOf(provider) {
    const value = numeric(provider.price);
    return value !== null && value >= 0 ? value : Infinity;
  }

  // Straight-line distance, not driving distance.
  function distanceKm(lat1, lng1, lat2, lng2) {
    const radians = value => value * Math.PI / 180;
    const dLat = radians(lat2 - lat1);
    const dLng = radians(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(dLng / 2) ** 2;

    return 6371 * 2 * Math.atan2(
      Math.sqrt(Math.min(1, a)),
      Math.sqrt(Math.max(0, 1 - a))
    );
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
function providerLink(provider) {
  const url = new URL("service.html", location.href);
  url.searchParams.set("provider", provider.id);

 url.searchParams.set(
  "returnTo",
  isResultsPage
    ? location.pathname + location.search
    : "index.html"
);

  return url.href;
}

 function makeCard(provider) {
  const providerName =
    provider.displayName || provider.fullName || "Provider";

  // This is read from users/{providerId} in Firestore.
  const shopName =
    typeof provider.shopName === "string"
      ? provider.shopName.trim()
      : "";

  const card = element("a", "nearby-card");
  card.href = providerLink(provider);

  const avatar = element(
    "div",
    "nearby-avatar",
    providerName.trim().charAt(0).toUpperCase()
  );

  try {
    const url = new URL(provider.photoURL);

    if (url.protocol === "https:") {
      const image = new Image();
      image.alt = `${providerName} profile photo`;

      image.onload = () => {
        avatar.replaceChildren(image);
      };

      image.onerror = () => {
        console.warn("Provider photo could not load:", url.href);
      };

      image.src = url.href;
    }
  } catch {
    console.warn("Invalid provider photo URL:", provider.photoURL);
  }
  const info = element("div", "nearby-info");

  info.append(
    element("strong", "nearby-name", shopName || providerName),
    element(
      "p",
      "nearby-service",
      provider.serviceCategory || "Repair services"
    )
  );

  const locationRow = element("p", "nearby-location");
  const locationName = element(
    "span",
    "nearby-location-name",
    "Finding location name…"
  );

  locationRow.append("⌖ ", locationName);
  info.append(locationRow);

 const rating = ratingOf(provider);
const ratingText =
  rating === null ? "Not yet rated" : `★ ${rating.toFixed(1)}`;

const reviewCount = provider.reviewCount ?? 0;
const reviewText =
  `${reviewCount} ${reviewCount === 1 ? "review" : "reviews"}`;

info.append(
  element(
    "p",
    "nearby-meta",
    `${ratingText} · ${reviewText}`
  )
);
const arrow = element(
  "span",
  "nearby-arrow",
  isResultsPage ? "View Provider" : "→"
);

if (!isResultsPage) {
  arrow.setAttribute("aria-hidden", "true");
}

arrow.setAttribute("title", "View service profile");

  card.append(avatar, info, arrow);

  if (isResultsPage) {
    card.classList.add("result-provider-card");

    const details = element("div", "result-card-details");

    const distance = element(
      "span",
      "result-distance",
     provider.distance === null
  ? "Distance unavailable"
  : `${provider.distance.toFixed(1)} km away`
    );
    details.append(distance);

    const price = priceOf(provider);
    if (Number.isFinite(price)) {
      details.append(
        element(
          "span",
          "result-price",
          `From ₱${price.toLocaleString()}`
        )
      );
    }

    card.append(details);
  }

  // Wait until the card is on the page before updating its place name.
  queueMicrotask(() => {
    if (card.isConnected) {
      void displayServiceLocation(provider, [locationName]);
    }
  });

  return card;
}

 

function updateMap(rows) {
    if (!map || !position) return;

    const point = [position.latitude, position.longitude];

    if (!customerMarker) {
      customerMarker = L.circleMarker(point, {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: "#2563eb",
        fillOpacity: 1
      }).addTo(map).bindPopup("Your current location");

      accuracyCircle = L.circle(point, {
        radius: position.accuracy || 0,
        color: "#2563eb",
        weight: 1,
        fillOpacity: 0.08
      }).addTo(map);
    }

    customerMarker.setLatLng(point);
    accuracyCircle
      .setLatLng(point)
      .setRadius(position.accuracy || 0);

    markers.clearLayers();

    for (const provider of rows) {
  if (!provider.point) continue;

  const popup = element("a", "", (
        provider.displayName || provider.fullName || "View provider"
      ));

      popup.href = providerLink(provider);

      L.circleMarker(provider.point, {
        radius: 7,
        color: "#008c80",
        fillColor: "#00b49a",
        fillOpacity: 0.9
      }).bindPopup(popup).addTo(markers);
    }

    if (!mapCentered) {
      map.setView(point, 12);
      mapCentered = true;
    }
  }

  function render() {
    if (closed) return;

    list.replaceChildren();
    markers?.clearLayers();

    if (count) count.textContent = "";
if (databaseError) {
  status.hidden = false;
  status.textContent = databaseError;
      return;
    }

   if (!position && !isResultsPage) {
  status.textContent = locationError ||
    "Allow location access to find nearby providers.";
  return;
}

if (!loaded) {
  status.hidden = false;
  status.textContent = "Loading approved providers…";

  if (isResultsPage) {
    list.append(element(
      "p",
      "nearby-empty",
      "Finding verified providers…"
    ));
  }
  return;
}
    const term = (searchInput?.value || "").trim().toLowerCase();

    let missingCoordinates = 0;

    const rows = providers.flatMap(provider => {
      const point = coordinates(provider);

     if (!point) {
  missingCoordinates++;
  if (!isResultsPage) return [];
}

     let distance = null;

if (position && point) {
  distance = distanceKm(
    position.latitude,
    position.longitude,
    point[0],
    point[1]
  );
}

// Home: only providers within 10 km.
// Search results: keep every verified provider, even if far away.
if (!isResultsPage && (distance === null || distance > RADIUS_KM)) {
  return [];
}

const normalize = value => String(value || "")
  .toLowerCase()
  .trim()
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ");

const aliases = {
  "electrician": ["electrician", "electrical"],
  "ac repair": ["ac repair", "aircon", "air conditioner", "hvac"],
  "plumber": ["plumber", "plumbing"],
  "appliance": ["appliance"],
  "carpenter": ["carpenter", "carpentry"],
  "auto tech": ["auto tech", "automotive", "mechanic", "car repair"],
  "gadget tech": ["gadget", "phone repair", "cellphone", "computer repair", "laptop repair"],
  "locksmith": ["locksmith"],
  "roofing": ["roofing", "roofer"],
  "welder": ["welder", "welding"]
};

const selected = normalize(term);
const service = normalize(provider.serviceCategory);
const serviceKey = normalize(provider.serviceCategoryKey);

const searchable = [
  provider.shopName,
  provider.displayName,
  provider.fullName,
  provider.serviceCategory,
  provider.customService,
  ...(Array.isArray(provider.skills) ? provider.skills : [])
].filter(Boolean).join(" ").toLowerCase();

const matches = aliases[selected]
  ? aliases[selected].some(name =>
      service.includes(name) || serviceKey.includes(name)
    )
  : selected === "others"
    ? serviceKey === "other" || serviceKey === "others"
    : searchable.includes(selected);

if (selected && !matches) return [];

      return [{ ...provider, point, distance }];
    });

rows.sort((a, b) => {
  if (sortBy === "nearest") {
    if (a.distance === null) return 1;
    if (b.distance === null) return -1;
    return a.distance - b.distance;
  }

  if (sortBy === "price") {
    const first = priceOf(a);
    const second = priceOf(b);

    if (first !== second) {
      return first < second ? -1 : 1;
    }

    if (a.distance === null) return 1;
    if (b.distance === null) return -1;

    return a.distance - b.distance;
  }

  // Top Rated
  const ratingDifference =
    (ratingOf(b) ?? -1) - (ratingOf(a) ?? -1);

  if (ratingDifference !== 0) {
    return ratingDifference;
  }

  if (a.distance === null) return 1;
  if (b.distance === null) return -1;

  return a.distance - b.distance;
});
if (isResultsPage) {
  status.textContent = "";
  status.hidden = true;
} else {
  status.textContent =
    `Within ${RADIUS_KM} km of your current location. ` +
    "Distances are approximate.";
}

    if (position && position.accuracy > 1000) {
      status.textContent += " Your device location has low accuracy.";
    }

    if (count) {
      count.textContent =
        `${rows.length} nearby provider${rows.length === 1 ? "" : "s"}`;
    }

    const visible = isResultsPage ? rows : rows.slice(0, HOME_LIMIT);

    if (isResultsPage && !visible.length && !serverConfirmed) {
      if (count) count.textContent = "Finding providers…";
      list.append(element(
        "p",
        "nearby-empty",
        "Finding verified providers…"
      ));
      return;
    }

    if (!visible.length) {
      if (count && isResultsPage) count.textContent = "0 providers";

      list.append(element(
        "p",
        "nearby-empty",
        isResultsPage && term
          ? `No verified providers for ${term} yet.`
          : isResultsPage
            ? "No verified providers available yet."
            : term
              ? "No nearby providers match your search."
              : "No approved providers with a saved location were found within 10 km."
      ));
    } else {
      list.append(...visible.map(makeCard));
    }

    if (missingCoordinates > 0 && !rows.length && !isResultsPage) {
      status.textContent +=
        " Some providers have not saved usable location coordinates.";
    }

    updateMap(rows);
  }

  function startLocation() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);

    watchId = null;
    position = null;
    locationError = "";
    retry.hidden = true;

    customerMarker?.remove();
    accuracyCircle?.remove();
    customerMarker = null;
    accuracyCircle = null;

    render();

    if (!navigator.geolocation) {
      locationError = "This browser does not support location access.";
      render();
      return;
    }

    watchId = navigator.geolocation.watchPosition(
      result => {
        if (closed) return;

        position = {
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
          accuracy: result.coords.accuracy
        };

        locationError = "";
        retry.hidden = true;
        render();
      },
      error => {
        if (closed) return;

        position = null;
        customerMarker?.remove();
        accuracyCircle?.remove();
        customerMarker = null;
        accuracyCircle = null;

        locationError = error.code === 1
          ? "Allow location access in your browser, then try again."
          : "Could not get your current location. Please try again.";

        retry.hidden = false;

        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        watchId = null;

        render();
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000
      }
    );
  }

  if (isResultsPage && window.L && document.getElementById("searchMap")) {
    map = L.map("searchMap").setView([0, 0], 2);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">' +
        "OpenStreetMap</a> contributors"
    }).addTo(map);

    markers = L.layerGroup().addTo(map);
  }

const stopProviders = onSnapshot(
  query(collection(db, "users"), where("role", "==", "provider")),
  { includeMetadataChanges: true },

  async snapshot => {
  serverConfirmed = !snapshot.metadata.fromCache;
  providers = snapshot.docs
    .map(item => ({ ...item.data(), id: item.id }))
.filter(provider =>
  provider.verified === true &&
  (isResultsPage || provider.id !== ctx.user.uid)
);

  await Promise.all(
    providers.map(async provider => {
      try {
        const reviewSnapshot = await getDocs(
          query(
            collection(db, "providerReviews"),
            where("providerId", "==", provider.id)
          )
        );

        const ratings = reviewSnapshot.docs
          .map(item => Number(item.data().rating))
          .filter(rating =>
            Number.isInteger(rating) &&
            rating >= 1 &&
            rating <= 5
          );

        provider.reviewCount = ratings.length;
        provider.rating = ratings.length
          ? ratings.reduce((sum, rating) => sum + rating, 0) /
            ratings.length
          : null;

        // Use the calculated reviews instead of an older saved rating.
        provider.averageRating = provider.rating;
      } catch (error) {
        console.warn("Could not load provider reviews:", error);
        provider.reviewCount = 0;
        provider.rating = null;
        provider.averageRating = null;
      }
    })
  );

  loaded = true;
  databaseError = "";
  render();
},
    error => {
      console.error("Nearby providers:", error);
      databaseError = "Could not load providers. Please refresh and try again.";
      render();
    }
  );

  const stopReviews = onSnapshot(
    collection(db, "providerReviews"),
    snapshot => {
      const ratingsByProvider = new Map();

      snapshot.forEach(item => {
        const { providerId, rating: rawRating } = item.data();
        const rating = Number(rawRating);

        if (
          !providerId ||
          !Number.isInteger(rating) ||
          rating < 1 ||
          rating > 5
        ) return;

        const values = ratingsByProvider.get(providerId) || [];
        values.push(rating);
        ratingsByProvider.set(providerId, values);
      });

      for (const provider of providers) {
        const ratings = ratingsByProvider.get(provider.id) || [];
        provider.reviewCount = ratings.length;
        provider.rating = ratings.length
          ? ratings.reduce((sum, value) => sum + value, 0) /
            ratings.length
          : null;
        provider.averageRating = provider.rating;
      }

      if (loaded) render();
    },
    error => console.error("Live provider ratings:", error)
  );

  searchInput?.addEventListener("input", render);
  retry.addEventListener("click", startLocation);

  for (const button of sortButtons) {
    button.addEventListener("click", () => {
      sortBy = button.dataset.sort;

      for (const chip of sortButtons) {
        const active = chip === button;
        chip.classList.toggle("chip-active", active);
        chip.classList.toggle("chip-inactive", !active);
        chip.setAttribute("aria-pressed", String(active));
      }

      render();
    });
  }

  startLocation();

  window.addEventListener("pagehide", () => {
    closed = true;
    stopProviders();
    stopReviews();

    if (watchId !== null)navigator.geolocation.clearWatch(watchId);
    map?.remove();
  }, { once: true });

  window.addEventListener("pageshow", event => {
    if (event.persisted && closed) location.reload();
  });
}

function setupAdminSidebar() {
  const sidebar = document.querySelector(".admin-sidebar");
  if (!sidebar) return;

  const navigation = sidebar.querySelector(".nav-list");
  if (!navigation) return;
  // Add Permit Renewals once, on every admin page.
if (!navigation.querySelector('a[href="admin-permit-renewals.html"]')) {
  const item = document.createElement("li");
  item.className = "nav-item";

  if (location.pathname.endsWith("/admin-permit-renewals.html")) {
    item.classList.add("active");
  }

  item.innerHTML = `
    <a href="admin-permit-renewals.html">
      <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5M8 12h8m-8 4h8"
          fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Permit Renewals
    </a>
  `;

  const reminders = navigation
    .querySelector('a[href="admin-reminders.html"]')
    ?.closest("li");

  if (reminders) reminders.after(item);
  else navigation.append(item);
}

  // Use the actual REPARO image.
  const logoContainer = sidebar.querySelector(".brand-logo");

  if (logoContainer) {
    const logo = document.createElement("img");
    logo.src = "logo.png";
    logo.alt = "REPARO logo";
    logo.width = 40;
    logo.height = 40;
    logo.className = "admin-brand-image";

    logoContainer.replaceChildren(logo);
  }

  // Keep one Complaints item on each page.
  const existingLinks = [
    ...navigation.querySelectorAll('a[href="admin-complaints.html"]')
  ];

  let complaintsItem = null;

  for (const link of existingLinks) {
    const item = link.closest("li");

    if (!complaintsItem && item) {
      complaintsItem = item;
    } else {
      if (item) item.remove();
      else link.remove();
    }
  }

  if (!complaintsItem) {
    complaintsItem = document.createElement("li");
    complaintsItem.className = "nav-item";

    const link = document.createElement("a");
    link.href = "admin-complaints.html";

    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    const path = document.createElementNS(namespace, "path");

    svg.setAttribute("class", "nav-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");

    path.setAttribute(
      "d",
      "M12 2 1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V8h2v5z"
    );

    svg.append(path);
    link.append(svg, document.createTextNode("Complaints"));
    complaintsItem.append(link);
  }

  // Place Complaints before Account.
  const accountHeading =
    navigation.querySelector(".nav-section-title");

  navigation.insertBefore(complaintsItem, accountHeading);

  // Highlight the page currently open.
  const currentPage = location.pathname.split("/").pop();

  for (const item of navigation.querySelectorAll("li.nav-item")) {
    const link = item.querySelector("a");
    if (!link) continue;

    const target = new URL(link.href, location.href);
    const active =
      target.pathname.split("/").pop() === currentPage;

    item.classList.toggle("active", active);

    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}
async function handleCustomerBookings(ctx) {
  const list = document.getElementById("customerBookingList");
  const status = document.getElementById("bookingStatus");
  const tabs = [...document.querySelectorAll("[data-booking-tab]")];

  if (!list || !status) return;

  let bookings = [];
  let lastSavedCompletedCount = null;
let selected = "all";
  let loaded = false;
  let errorText = "";
  let selectedBooking = null;
  let savingReview = false;

  const busy = new Set();
  const providers = new Map();
  const providerListeners = new Map();

  function node(tag, className = "", text) {
    const result = document.createElement(tag);
    result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }

function customerStatus(booking) {
  if (booking.status === "declined") return "declined";

  if (booking.status === "cancelled" ||
      booking.status === "canceled") {
    return "cancelled";
  }

  // The provider finishing is only the first step.
  // The customer booking is complete after the customer rates it.
  if (booking.customerRated === true) return "completed";

  if (booking.status === "completed") return "confirmed";

  return booking.status || "pending";
}

  function schedule(value) {
    const date = typeof value?.toDate === "function"
      ? value.toDate()
      : new Date(value);

    return !value || Number.isNaN(date.getTime())
      ? "Schedule not provided"
      : date.toLocaleString("en-PH");
  }

  function money(value) {
    const amount = Number(value);
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP"
    }).format(Number.isFinite(amount) ? amount : 0);
  }

  const dialog = document.createElement("dialog");
  dialog.className = "booking-rating-dialog";
  dialog.innerHTML = `
    <form>
      <h2>Rate your provider</h2>
      <p data-provider-name></p>

      <input id="bookingRatingValue" type="hidden" value="">

<div class="booking-star-picker" role="group" aria-label="Your rating">
  <button type="button" data-star="1"
    aria-label="1 star" aria-pressed="false">★</button>
  <button type="button" data-star="2"
    aria-label="2 stars" aria-pressed="false">★</button>
  <button type="button" data-star="3"
    aria-label="3 stars" aria-pressed="false">★</button>
  <button type="button" data-star="4"
    aria-label="4 stars" aria-pressed="false">★</button>
  <button type="button" data-star="5"
    aria-label="5 stars" aria-pressed="false">★</button>
</div>
      <label for="bookingRatingComment">Feedback (optional)</label>
      <textarea id="bookingRatingComment" rows="4"
        maxlength="2000"
        placeholder="How was the repair service?"></textarea>

      <p data-feedback role="status"></p>

      <div class="booking-rating-actions">
        <button type="button" data-later>Later</button>
        <button type="submit">Submit Rating</button>
      </div>
    </form>
  `;
  document.body.append(dialog);

  const form = dialog.querySelector("form");
const ratingInput = dialog.querySelector("#bookingRatingValue");
const starButtons = [...dialog.querySelectorAll("[data-star]")];

dialog.setAttribute("aria-label", "Rate your provider");

function paintStars() {
  const selectedRating = Number(ratingInput.value);

  starButtons.forEach(button => {
    const value = Number(button.dataset.star);

    button.classList.toggle("selected", value <= selectedRating);
    button.setAttribute(
      "aria-pressed",
      String(value === selectedRating)
    );
  });
}

starButtons.forEach(button => {
  button.addEventListener("click", () => {
    if (savingReview) return;

    ratingInput.value = button.dataset.star;
    paintStars();
  });
});

form.addEventListener("reset", () => {
  ratingInput.value = "";
  starButtons.forEach(button => {
    button.classList.remove("selected");
    button.setAttribute("aria-pressed", "false");
  });
});
  const commentInput = dialog.querySelector("textarea");
  const feedback = dialog.querySelector("[data-feedback]");
  const later = dialog.querySelector("[data-later]");
  const submit = dialog.querySelector('[type="submit"]');

  later.addEventListener("click", () => {
    if (!savingReview) dialog.close();
  });

  dialog.addEventListener("cancel", event => {
    if (savingReview) event.preventDefault();
  });

  function openRating(booking) {
    selectedBooking = booking;
    form.reset();
    feedback.textContent = "";

    const profile = providers.get(booking.providerId);
    dialog.querySelector("[data-provider-name]").textContent =
      profile?.displayName ||
      profile?.fullName ||
      booking.providerName ||
      "Provider";

    if (!dialog.open) dialog.showModal();
  }

  function watchProvider(id) {
    if (!id || providerListeners.has(id)) return;

    // Register first, so a render cannot attach a duplicate listener.
    providerListeners.set(id, () => {});

    const unsubscribe = onSnapshot(
      doc(db, "users", id),
      snapshot => {
        providers.set(id, snapshot.exists() ? snapshot.data() : {});
        render();
      },
      error => {
        console.error("Booking provider photo:", error);
        providers.set(id, {});
        render();
      }
    );

    providerListeners.set(id, unsubscribe);
  }

  function render() {
    tabs.forEach(tab => {
      const tabStatus = tab.dataset.bookingTab;
      const active = selected === tabStatus;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));

      const badge = tab.querySelector(".tab-badge");
      const count = bookings.filter(booking =>
        tabStatus === "all"
          ? true
          : tabStatus === "report"
            ? booking.customerRated === true
            : customerStatus(booking) === tabStatus
      ).length;

      if (badge) {
        badge.textContent = String(count);
        badge.hidden = count === 0;
      }
    });

    list.replaceChildren();

      status.textContent = errorText;
    status.hidden = !status.textContent;

    if (!loaded || errorText) return;

    const visible = bookings.filter(booking =>
      selected === "all"
        ? true
        : selected === "report"
          ? booking.customerRated === true
          : customerStatus(booking) === selected
    );

    if (!visible.length) {
          list.append(node(
        "p",
        "",
        selected === "all" ? "No bookings yet." : `No ${selected} bookings.`
      ));
      return;
    }

    for (const booking of visible) {
      const profile = providers.get(booking.providerId) || {};
      const name = profile.displayName ||
        profile.fullName ||
        booking.providerName ||
        "Provider";

      const card = node("article", "customer-booking-card");
      const header = node("div", "customer-booking-heading");
      const avatar = node("div", "customer-booking-avatar");
      const fallback = node("span", "", name.charAt(0).toUpperCase());
      avatar.append(fallback);

      const rawPhoto = profile.photoURL || booking.providerPhotoURL;

      if (rawPhoto) {
        try {
          const url = new URL(rawPhoto);
          if (url.protocol === "https:") {
            const image = document.createElement("img");
            image.alt = `${name}'s profile photo`;
            image.hidden = true;

            image.onload = () => {
              fallback.hidden = true;
              image.hidden = false;
            };
            image.onerror = () => {
              image.remove();
              fallback.hidden = false;
            };

            avatar.append(image);
            image.src = url.href;
          }
        } catch {
          // Keep the initials if no valid photo URL is available.
        }
      }

      const identity = node("div", "customer-booking-identity");
      identity.append(
        node("h3", "", name),
        node("p", "", booking.service || "Repair service")
      );

      header.append(
        avatar,
        identity,
node(
  "span",
  "customer-booking-state",
  booking.status === "declined"
    ? "Declined"
: booking.status === "cancelled" || booking.status === "canceled"
  ? booking.cancelReason === "provider_timeout"
    ? "Cancelled: no provider response"
    : "Cancelled by you"
      : booking.status === "confirmed"
        ? "Confirmed"
        : selected
)
      );

      card.append(
        header,
        node("p", "", schedule(booking.scheduledAt)),
        node("p", "", booking.location || "Location not provided")
      );

      if (booking.notes) {
        card.append(node("p", "", booking.notes));
      }

      if (
        booking.status === "completed" &&
        booking.customerCompleted !== true
      ) {
        card.append(node(
          "p",
          "customer-booking-note",
          "The provider marked this work done. Confirm when it is finished."
        ));
      }

      const actions = node("div", "customer-booking-actions");
      actions.append(node("strong", "", money(booking.price)));

      const view = node("a", "", "View Provider");
      view.href =
        `service.html?provider=${encodeURIComponent(booking.providerId)}`;
      actions.append(view);

      if (booking.status === "declined") {
        actions.append(
          node("span", "booking-declined-sign", "Declined")
        );
      }

if (customerStatus(booking) === "confirmed") {
  if (booking.customerCompleted === true) {
    const rate = node("button", "", "Rate Provider");
    rate.type = "button";
    rate.addEventListener("click", () => openRating(booking));
    actions.append(rate);
  } else if (booking.status === "completed") {
    const done = node("button", "", "Mark as Done");
    done.type = "button";
    done.disabled = busy.has(booking.id);
    done.addEventListener("click", () => completeBooking(booking));
    actions.append(done);
  }
}
      if (selected === "completed" || selected === "report") {
        if (booking.customerRated === true) {
          const report = node("button", "customer-report-button", "Report");
report.type = "button";
report.dataset.reportBooking = booking.id;
report.setAttribute("aria-label", "Report this provider");
actions.append(report);
        } else {
          const rate = node("button", "", "Rate Provider");
          rate.type = "button";
          rate.addEventListener("click", () => openRating(booking));
          actions.append(rate);
        }
      }

      if (selected === "pending") {
        const cancel = node("button", "", "Cancel Booking");
        cancel.type = "button";
        cancel.disabled = busy.has(booking.id);
        cancel.addEventListener("click", async () => {
          if (busy.has(booking.id)) return;
          if (!confirm("Cancel this pending booking?")) return;

          busy.add(booking.id);
          render();

          try {
            await runTransaction(db, async transaction => {
              const reference = doc(db, "bookings", booking.id);
              const snapshot = await transaction.get(reference);
              const current = snapshot.data();

              if (
                !snapshot.exists() ||
                current.customerId !== ctx.user.uid ||
                current.status !== "pending"
              ) {
                throw new Error("This booking can no longer be cancelled.");
              }

              transaction.update(reference, {
                status: "cancelled",
                updatedAt: serverTimestamp()
              });
            });
          } catch (error) {
            alert(error.message || "Could not cancel booking.");
          } finally {
            busy.delete(booking.id);
            render();
          }
        });
        actions.append(cancel);
      }

      card.append(actions);
      list.append(card);
    }
  }
let completionPromptOpen = false;

function askCompletion() {
  if (completionPromptOpen) return Promise.resolve(false);

  completionPromptOpen = true;

  return new Promise(resolve => {
    const popup = document.createElement("dialog");
    popup.className = "booking-confirm-dialog";
    popup.setAttribute("aria-labelledby", "bookingConfirmTitle");
    popup.setAttribute("aria-describedby", "bookingConfirmDescription");

    popup.innerHTML = `
      <div class="booking-confirm-icon" aria-hidden="true">✓</div>

      <h2 id="bookingConfirmTitle">Mark service as done?</h2>

      <p id="bookingConfirmDescription">
        Confirm that the repair is finished.
        You can rate your provider next.
      </p>

      <div class="booking-rating-actions">
        <button type="button" data-cancel autofocus>
          Not Yet
        </button>

        <button type="button" data-confirm>
          Yes, Mark as Done
        </button>
      </div>
    `;

    let accepted = false;

    popup.querySelector("[data-cancel]").addEventListener("click", () => {
      popup.close();
    });

    popup.querySelector("[data-confirm]").addEventListener("click", () => {
      accepted = true;
      popup.close();
    });

    popup.addEventListener("close", () => {
      popup.remove();
      completionPromptOpen = false;
      resolve(accepted);
    }, { once: true });

    document.body.append(popup);
    popup.showModal();
  });
}async function completeBooking(booking) {
  if (busy.has(booking.id)) return;
  if (!(await askCompletion())) return;

  busy.add(booking.id);
  render();

  try {
    await runTransaction(db, async transaction => {
      const reference = doc(db, "bookings", booking.id);
      const snapshot = await transaction.get(reference);

      if (
        !snapshot.exists() ||
        snapshot.data().customerId !== ctx.user.uid ||
        snapshot.data().status !== "completed"
      ) {
        throw new Error("Wait for the provider to mark the work done.");
      }

      if (snapshot.data().customerCompleted === true) return;

      transaction.update(reference, {
        customerCompleted: true,
        customerCompletedAt: serverTimestamp()
      });
    });

    bookings = bookings.map(item =>
      item.id === booking.id
        ? { ...item, customerCompleted: true }
        : item
    );

    // Stay in Confirmed until the rating is saved.
    selected = "confirmed";
    render();
    openRating({ ...booking, customerCompleted: true });
  } catch (error) {
    alert(error.message || "Could not mark the booking done.");
  } finally {
    busy.delete(booking.id);
    render();
  }
}

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (savingReview || !selectedBooking) return;

    const rating = Number(ratingInput.value);
    const comment = commentInput.value.trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      feedback.textContent = "Choose a rating from 1 to 5.";
      return;
    }

    if (comment.length > 2000) return;

    savingReview = true;
    submit.disabled = later.disabled = true;
    ratingInput.disabled = commentInput.disabled = true;
    feedback.textContent = "Saving your rating…";

    const booking = selectedBooking;

    try {
      await runTransaction(db, async transaction => {
        const bookingRef = doc(db, "bookings", booking.id);
        const reviewRef = doc(db, "providerReviews", booking.id);

        const bookingSnapshot = await transaction.get(bookingRef);
        const reviewSnapshot = await transaction.get(reviewRef);
        const current = bookingSnapshot.data();

        if (
          !bookingSnapshot.exists() ||
          current.customerId !== ctx.user.uid ||
          current.customerCompleted !== true
        ) {
          throw new Error("Complete your booking before rating.");
        }

        if (reviewSnapshot.exists()) {
          throw new Error("A rating was already submitted for this booking.");
        }

        transaction.set(reviewRef, {
          bookingId: booking.id,
          providerId: current.providerId,
          customerId: ctx.user.uid,
          rating,
          comment,
          createdAt: serverTimestamp()
        });

        transaction.update(bookingRef, {
          customerRated: true
        });
      });

      bookings = bookings.map(item =>
        item.id === booking.id ? { ...item, customerRated: true } : item
      );

    dialog.close();
selected = "completed";
render();
    } catch (error) {
      console.error("Save provider rating:", error);
      feedback.textContent = error.message || "Could not save your rating.";
    } finally {
      savingReview = false;
      submit.disabled = later.disabled = false;
      ratingInput.disabled = commentInput.disabled = false;
    }
  });

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      selected = tab.dataset.bookingTab;
      render();
    });
  });

  const stop = onSnapshot(
    query(collection(db, "bookings"), where("customerId", "==", ctx.user.uid)),
    snapshot => {
      bookings = snapshot.docs.map(item => ({
        ...item.data(),
        id: item.id
      })).sort((a, b) =>
        (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
      );

        loaded = true;
      errorText = "";
      bookings.forEach(booking => watchProvider(booking.providerId));
      render();
      void cancelExpiredPendingBookings(bookings);
    },
    error => {
      loaded = true;
      errorText = "Could not load bookings. Please refresh to retry.";
      console.error(error);
      render();
    }
  );

  window.addEventListener("pagehide", () => {
    stop();
    providerListeners.forEach(unsubscribe => unsubscribe());
    dialog.remove();
  }, { once: true });

  window.addEventListener("pageshow", event => {
    if (event.persisted) location.reload();
  });

  render();
}
function handleProviderAccountProfile(ctx) {
  const subscriptions = [];
  let stopped = false;
  let currentPhoto = "";

  const put = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  // Link providers directly to their public service page.
  // Show Service Profile as its own card below Account Info.
const accountCard = document.querySelector(".profile-card");

if (accountCard && !document.getElementById("viewProviderService")) {
  const serviceCard = document.createElement("section");
  serviceCard.className = "profile-card permit-card service-card";

  serviceCard.innerHTML = `
    <div class="permit-card-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="7" r="4"/>
        <path d="M4 21v-2a8 8 0 0 1 16 0v2"/>
      </svg>
    </div>

    <div class="permit-card-content">
      <h2>Service Profile</h2>
      <p>See how customers view your repair services.</p>
    </div>

    <a id="viewProviderService"
       class="permit-card-link"
       href="service.html?provider=${encodeURIComponent(ctx.user.uid)}&back=provider-profile">
      <span>View Service Profile</span>
      <span aria-hidden="true">→</span>
    </a>
  `;

  accountCard.after(serviceCard);
}
  subscriptions.push(
    onSnapshot(
      doc(db, "users", ctx.user.uid),

      snapshot => {
        if (stopped) return;

        if (!snapshot.exists()) {
          put("providerName", "Profile not found");
          put(
            "profileStatus",
            "Your provider account record could not be found."
          );
          return;
        }

        const profile = snapshot.data();

        const name =
          profile.displayName ||
          profile.fullName ||
          ctx.user.displayName ||
          "Name not provided";

        const email =
          profile.email ||
          ctx.user.email ||
          "Email not provided";

        const phone =
          profile.contactNumber ||
          profile.phone ||
          profile.phoneNumber ||
          "Phone not provided";

        put("providerName", name);
        put("accountName", name);

        put("providerEmail", email);
        put("accountEmail", email);

        put("accountPhone", phone);

        put(
          "providerService",
          String(profile.serviceCategory || "")
            .replace(/_/g, " ")
        );

        void displayServiceLocation(
          profile,
          [
            document.getElementById("providerLocation"),
            document.getElementById("accountLocation")
          ]
        );

        const image =
          document.getElementById("providerPhoto");

        const avatar =
          document.getElementById("providerAvatar");

        let photoURL = "";

        try {
          const parsed = new URL(profile.photoURL);

          if (parsed.protocol === "https:") {
            photoURL = parsed.href;
          }
        } catch {
          // No valid saved photo.
        }

        if (image && avatar && photoURL !== currentPhoto) {
          currentPhoto = photoURL;
          avatar.hidden = true;
          image.removeAttribute("src");

          if (photoURL) {
            image.onload = () => {
              if (!stopped && currentPhoto === photoURL) {
                avatar.hidden = false;
              }
            };

            image.onerror = () => {
              avatar.hidden = true;
            };

            image.src = photoURL;
          }
        }

        put("profileStatus", "");
      },

      error => {
        console.error("Provider profile:", error);

        put("providerName", "Unable to load profile");

        put(
          "profileStatus",
          "Could not load your account. Check your connection and reload."
        );
      }
    )
  );

  subscriptions.push(
    onSnapshot(
      query(
        collection(db, "bookings"),
        where("providerId", "==", ctx.user.uid)
      ),

      snapshot => {
        if (!stopped) {
          put("providerBookings", String(snapshot.size));
        }
      },

      error => {
        console.error("Provider bookings:", error);
        put("providerBookings", "—");
      }
    )
  );

  subscriptions.push(
    onSnapshot(
      query(
        collection(db, "providerReviews"),
        where("providerId", "==", ctx.user.uid)
      ),

      snapshot => {
        if (stopped) return;

        const ratings = snapshot.docs
          .map(item => Number(item.data().rating))
          .filter(value => (
            Number.isInteger(value) &&
            value >= 1 &&
            value <= 5
          ));

        const average = ratings.length
          ? ratings.reduce((sum, value) => sum + value, 0)
            / ratings.length
          : null;

        put(
          "providerRating",
          average === null ? "—" : average.toFixed(1)
        );

        put("providerReviews", String(ratings.length));
      },

      error => {
        console.error("Provider reviews:", error);
        put("providerRating", "—");
        put("providerReviews", "—");
      }
    )
  );

  window.addEventListener("pagehide", () => {
    stopped = true;
    subscriptions.forEach(unsubscribe => unsubscribe());
  }, { once: true });

  window.addEventListener("pageshow", event => {
    if (event.persisted) location.reload();
  });
}async function boot() {
  setupAdminSidebar();
  wireDrawer();

  if (PUBLIC_PAGES.has(page)) return;

  const roles =
    ADMIN_PAGES.has(page) || page === "admin-complaints.html"
      ? ["admin"]
      : PROVIDER_PAGES.has(page)
        ? ["provider", "admin"]
        : null;

  const ctx = await requireAuth(roles);
  if (!ctx) return;
  if (page === "index.html") {
  startNearbyProviders(ctx);
}
  installAccountSwitch(ctx); // switch aacount
  await loadProfile(ctx);
  startLiveNotifications(ctx);
startAdminSearch(ctx);
  if (["index.html","myprofile.html","settings.html","web-rate.html"].includes(page)) await handleProfile(ctx);
  if (["index.html", "search.html"].includes(page)) { startHomeIdentityAndMap(ctx);}
  if (["settings.html","rm-settings.html"].includes(page)) await handleSettings(ctx);
  if (page === "post.html") await handlePostRequest(ctx);
  if (page === "book-repair.html") await handleBookRepair(ctx);
  if (page === "mybooking.html") await handleCustomerBookings(ctx);
if (page === "rm-index.html") {await handleProviderDashboard(ctx);}
if (page === "rm-booking.html") {await handleProviderBookings(ctx);}
if (page === "rm-profile.html") {handleProviderAccountProfile(ctx);}
  if (page === "be-provider.html") await handleProviderStep1(ctx);
  if (page === "be-provider2.html") await handleProviderStep2(ctx);
  if (page === "be-provider3.html") await handleProviderStep3(ctx);
 if (page === "search.html") { await handleSearch(ctx);}
if (page === "search-results.html") {startNearbyProviders(ctx, true);}
  if (page === "service.html") { await handleServiceDetails(ctx); }
  if (page === "notification.html") await handleNotifications(ctx);
  if (page === "web-rate.html") await handleRating(ctx);
  if (page === "admin-approval.html") await handleAdminApprovals(ctx);
  if (page === "view-permit.html") await handlePermitReview(ctx);
  if (page === "admin-provider.html") await handleAdminProviders();
  if (page === "admin-logs.html") await handleAdminLogs();
  if (page === "admin-index.html") await handleAdminDashboard();
  if (page === "admin-reminders.html") await handleAdminReminders(ctx);
  if (page === "admin-settings.html") await handleAdminSettings(ctx);
  if (page === "admin-edit.html") await handleAdminEdit(ctx);
  if (page === "admin-support.html") { await handleAdminSupport(ctx); }
  if (page === "chat.html") await handleChat(ctx);
  if (page === "message.html") await handleMessages(ctx);

}

boot().catch(error => { console.error("REPARO Firebase page error:", error); flash(error.message || "A Firebase error occurred.", "error"); });
// ==========================================
// COMMUNITY REQUEST ELEMENTS
// ==========================================

const communityRequests =
    document.getElementById("communityRequests");

const communityLoading =
    document.getElementById("communityLoading");

async function getCurrentProfile() {

    const user =
        auth.currentUser;


    if (!user) {

        return null;

    }


    try {

        const snapshot =
            await getDoc(
                doc(
                    db,
                    "users",
                    user.uid
                )
            );


        if (!snapshot.exists()) {

            return null;

        }


        return snapshot.data();


    } catch (error) {

        console.error(
            "Profile error:",
            error
        );


        return null;
    }

}
// ==========================================
// COMMUNITY REQUEST HELPERS
// ==========================================

function serviceName(service) {

    const names = {
        electrician: "Electrician",
        ac_repair: "AC Repair",
        plumber: "Plumber",
        appliance: "Appliance",
        carpenter: "Carpenter",
        auto_tech: "Auto Tech",
        gadget_tech: "Gadget Tech",
        locksmith: "Locksmith",
        roofing: "Roofing",
        welder: "Welder"
    };

    return names[service] || service || "Repair Service";
}


function formatTime(timestamp) {

    if (!timestamp) {
        return "Just now";
    }

    try {

        const date =
            timestamp.toDate
                ? timestamp.toDate()
                : new Date(timestamp);

        const now = new Date();

        const seconds =
            Math.floor(
                (now - date) / 1000
            );


        if (seconds < 60) {
            return "Just now";
        }


        const minutes =
            Math.floor(seconds / 60);

        if (minutes < 60) {
            return `${minutes}m ago`;
        }


        const hours =
            Math.floor(minutes / 60);

        if (hours < 24) {
            return `${hours}h ago`;
        }


        const days =
            Math.floor(hours / 24);

        if (days < 7) {
            return `${days}d ago`;
        }


        return date.toLocaleDateString();

    } catch (error) {

        console.error(
            "Time format error:",
            error
        );

        return "";
    }
}
async function startCommunityRequests() {

    if (!communityRequests) {

        return;

    }


    const profile =
        await getCurrentProfile();


    const currentUser =
        auth.currentUser;


    const isProvider =
        profile?.role === "provider";

    const requestsQuery = query(
        collection(db, "serviceRequests"),
        orderBy("createdAt", "desc")
    );

onSnapshot(
    requestsQuery,

    async (snapshot) => {

        // REMOVE LOADING MESSAGE
        if (communityLoading) {
            communityLoading.style.display = "none";
        }

        communityRequests.innerHTML = "";

            let foundOpenRequest = false;
            let shownOnHome = 0;

            for (
                const requestDocument
                of snapshot.docs
            ) {

                const request =
                    requestDocument.data();


                if (
                    page !== "community.html" &&
                    request.status !== "open"
                ) {
                    continue;
                }


                foundOpenRequest =
                    true;


                const requestId =
                    requestDocument.id;


                const card =
                    document.createElement(
                        "div"
                    );


                card.className =
                    "request-card";


                card.dataset.requestId =
                    requestId;


                card.innerHTML = `

                    <div class="card-top">

                        <div class="user-meta">

                            <div
                                class="community-avatar"
                            >
                                ${(
                                    request.customerName ||
                                    "U"
                                )
                                    .charAt(0)
                                    .toUpperCase()}
                            </div>


                            <div>

                                <div
                                    class="user-name-row"
                                >

                                    <span
                                      class="request-author-name"
                                    >
                                        ${
                                            escapeHtml(
                                                request.customerName ||
                                                "Customer"
                                            )
                                        }
                                    </span>


                                    <span
                                        class="status-badge"
                                    >
                                       ${escapeHtml(request.status || "Open")}
                                    </span>

                                </div>


                                <div
                                    class="category-time"
                                >

                                    <span
                                        class="category-pill"
                                    >
                                        ${
                                            escapeHtml(
                                                serviceName(
                                                    request.service
                                                )
                                            )
                                        }
                                    </span>


                                    <span
                                        class="time-ago"
                                    >
                                        ${
                                            formatTime(
                                                request.createdAt
                                            )
                                        }
                                    </span>

                                </div>

                            </div>

                        </div>

                    </div>



                    <div class="request-body">

                        <h3
                            class="request-title"
                        >
                            ${
                                escapeHtml(
                                    request.title ||
                                    "Service Request"
                                )
                            }
                        </h3>


                        <p
                            class="request-desc"
                        >
                            ${
                                escapeHtml(
                                    request.description ||
                                    ""
                                )
                            }
                        </p>

                    </div>



                    <div class="card-footer">

                        <div
                            class="footer-item"
                        >

                            

                            <span>
                                ${
                                    escapeHtml(
                                        request.location ||
                                        "No location"
                                    )
                                }
                            </span>

                        </div>


                        <div
                            class="footer-item"
                        >

                            <span>

                                ${
                                    request.budget
                                        ? "₱ " +
                                          escapeHtml(
                                              request.budget
                                          )
                                        : "Budget not specified"
                                }

                            </span>

                        </div>

                    </div>



                    <div
                        class="community-actions"
                    >

                        <button
                            type="button"
                            class="react-request-btn"
                            data-request-id="${requestId}"
                            ${!isProvider ? "disabled" : ""}
                        >
                            👍 Interested
                            <span
                                class="reaction-count"
                                id="reaction-${requestId}"
                            >
                                0
                            </span>
                        </button>


                        <button
                            type="button"
                            class="comment-request-btn"
                            data-request-id="${requestId}"
                            ${!isProvider ? "disabled" : ""}
                        >
                            💬 Comment
                            <span
                                class="comment-count"
                                id="comment-${requestId}"
                            >
                                0
                            </span>
                        </button>

                    </div>


                    ${
                        isProvider

                        ? `

                        <div
                            class="provider-comment-box"
                        >

                            <input
                                type="text"
                                class="provider-comment-input"
                                id="commentInput-${requestId}"
                                placeholder="Write a response to this customer..."
                                maxlength="300"
                            >


                            <button
                                type="button"
                                class="send-provider-comment"
                                data-request-id="${requestId}"
                            >
                                Send
                            </button>

                        </div>

                        `

                        : ""
                    }


                    <div
                        class="request-comments"
                        id="commentsList-${requestId}"
                    ></div>

                `;


                communityRequests.appendChild(card);

                if (page === "index.html") {
                    shownOnHome++;

                    if (shownOnHome >= 5) {
                        watchRequestComments(requestId);
                        watchRequestReactions(requestId);
                        break;
                    }
                }

                watchRequestComments(
                    requestId
                );


                watchRequestReactions(
                    requestId
                );

            }


            if (!foundOpenRequest) {

                communityRequests.innerHTML =
                    `

                    <p
                        style="
                            text-align:center;
                            padding:25px;
                            color:#94a3b8;
                            font-size:13px;
                        "
                    >
                        No community requests yet.
                    </p>

                    `;
            }

        },

        (error) => {

    console.error(
        "Community requests error:",
        error
    );

    if (communityLoading) {
        communityLoading.style.display = "none";
    }

    communityRequests.innerHTML = `
        <p
            style="
                text-align:center;
                color:#dc3545;
                padding:20px;
            "
        >
            Could not load community requests.
        </p>
    `;

        }
    );

}
// ==========================================
// WATCH COMMENTS
// ==========================================

function watchRequestComments(requestId) {

    const commentsList =
        document.getElementById(
            `commentsList-${requestId}`
        );

    const commentCount =
        document.getElementById(
            `comment-${requestId}`
        );


    const commentsQuery =
        query(
            collection(
                db,
                "serviceRequests",
                requestId,
                "comments"
            ),
            orderBy(
                "createdAt",
                "asc"
            )
        );


    onSnapshot(
        commentsQuery,

        snapshot => {

            if (commentCount) {
                commentCount.textContent =
                    snapshot.size;
            }


            if (!commentsList) {
                return;
            }


            commentsList.innerHTML =
                "";


            snapshot.forEach(
                commentDoc => {

                    const comment =
                        commentDoc.data();


                    const commentItem =
                        document.createElement(
                            "div"
                        );


                    commentItem.className =
                        "request-comment-item";


                    commentItem.innerHTML = `

                        <strong>
                            ${escapeHtml(
                                comment.providerName
                                || "Provider"
                            )}
                        </strong>

                        <p>
                            ${escapeHtml(
                                comment.message
                                || ""
                            )}
                        </p>

                    `;


                    commentsList.appendChild(
                        commentItem
                    );

                }
            );

        },

        error => {

            console.error(
                "Comments listener error:",
                error
            );

        }
    );
}



// ==========================================
// WATCH REACTIONS
// ==========================================

function watchRequestReactions(requestId) {

    const reactionCount =
        document.getElementById(
            `reaction-${requestId}`
        );


    const reactionsQuery =
        collection(
            db,
            "serviceRequests",
            requestId,
            "reactions"
        );


    onSnapshot(
        reactionsQuery,

        snapshot => {

            if (reactionCount) {

                reactionCount.textContent =
                    snapshot.size;

            }

        },

        error => {

            console.error(
                "Reaction listener error:",
                error
            );

        }
    );
}



// ==========================================
// ADD PROVIDER COMMENT
// ==========================================

async function addProviderComment(
    requestId,
    message
) {

    const user =
        auth.currentUser;


    if (!user) {
        return;
    }


    const profile =
        await getCurrentProfile();


    if (
        profile?.role !==
        "provider"
    ) {

        alert(
            "Only approved providers can comment."
        );

        return;
    }


    const cleanMessage =
        String(
            message || ""
        ).trim();


    if (!cleanMessage) {
        return;
    }


    try {

        await addDoc(
            collection(
                db,
                "serviceRequests",
                requestId,
                "comments"
            ),
            {

                providerId:
                    user.uid,

                providerName:
                    profile.displayName
                    || user.displayName
                    || "Provider",

                message:
                    cleanMessage,

                createdAt:
                    serverTimestamp()

            }
        );


    } catch (error) {

        console.error(
            "Add comment error:",
            error
        );

    }

}
async function toggleProviderReaction(
    requestId
) {

    const user =
        auth.currentUser;


    if (!user) {

        return;

    }


    const profile =
        await getCurrentProfile();


    if (
        profile?.role !== "provider"
    ) {

        alert(
            "Only approved providers can react."
        );

        return;
    }


    const reactionRef =
        doc(
            db,
            "serviceRequests",
            requestId,
            "reactions",
            user.uid
        );


    try {

        const reactionSnapshot =
            await getDoc(
                reactionRef
            );


        if (
            reactionSnapshot.exists()
        ) {

            await deleteDoc(
                reactionRef
            );

        } else {

            await setDoc(
                reactionRef,
                {

                    providerId:
                        user.uid,

                    providerName:
                        profile.displayName ||
                        user.displayName ||
                        "Provider",

                    reaction:
                        "interested",

                    createdAt:
                        serverTimestamp()

                }
            );

        }


    } catch (error) {

        console.error(
            "Reaction error:",
            error
        );

    }



}
document.addEventListener(
    "click",
    async (event) => {


        // PROVIDER REACTION

        const reactButton =
            event.target.closest(
                ".react-request-btn"
            );


        if (reactButton) {

            if (
                reactButton.disabled
            ) {

                return;

            }


            await toggleProviderReaction(
                reactButton.dataset.requestId
            );


            return;
        }



        // SEND COMMENT

        const commentButton =
            event.target.closest(
                ".send-provider-comment"
            );


        if (commentButton) {

            const requestId =
                commentButton.dataset.requestId;


            const input =
                document.getElementById(
                    `commentInput-${requestId}`
                );


            if (!input) {

                return;

            }


            const message =
                input.value.trim();


            if (!message) {

                return;

            }


            await addProviderComment(
                requestId,
                message
            );


            input.value =
                "";


            return;
        }

    }
);
onAuthStateChanged(
    auth,
    (user) => {

        if (
            user &&
            communityRequests
        ) {

            startCommunityRequests();

        }

    }
);
function setupCompactAdminMenu() {
  const sidebar = document.querySelector(".admin-sidebar");
  const brand = sidebar?.querySelector(".sidebar-brand");
  const navigation = sidebar?.querySelector(".nav-list");

  if (!sidebar || !brand || !navigation) return;
  if (sidebar.querySelector(".admin-menu-toggle")) return;

  if (!navigation.id) {
    navigation.id = "adminNavigation";
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "admin-menu-toggle";
  button.textContent = "☰ Menu";
  button.setAttribute("aria-controls", navigation.id);
  button.setAttribute("aria-expanded", "false");

  function setOpen(open) {
    sidebar.classList.toggle("menu-open", open);
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? "✕ Close" : "☰ Menu";
  }

  button.addEventListener("click", () => {
    setOpen(!sidebar.classList.contains("menu-open"));
  });

  sidebar.addEventListener("keydown", event => {
    if (
      event.key === "Escape" &&
      sidebar.classList.contains("menu-open")
    ) {
      setOpen(false);
      button.focus();
    }
  });

  brand.append(button);
  sidebar.classList.add("menu-ready");
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    setupCompactAdminMenu,
    { once: true }
  );
} else {
  setupCompactAdminMenu();
}
