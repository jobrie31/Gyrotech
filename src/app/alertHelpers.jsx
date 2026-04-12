// src/app/alertHelpers.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Lecture du hash avec route + paramètre
// - Création d'un hash de navigation
// - Navigation utilitaire vers une page / une conversation
// -----------------------------------------------------------------------------

export function decodeHashPart(value) {
  try {
    return decodeURIComponent(String(value || "").trim());
  } catch {
    return String(value || "").trim();
  }
}

export function encodeHashPart(value) {
  return encodeURIComponent(String(value || "").trim());
}

export function getRouteInfoFromHash() {
  const raw = window.location.hash.replace(/^#\//, "");
  const parts = raw.split("/").filter(Boolean);

  return {
    route: decodeHashPart(parts[0] || "accueil"),
    param: decodeHashPart(parts[1] || ""),
  };
}

export function makeHash(route, param = "") {
  const cleanRoute = String(route || "accueil").trim() || "accueil";
  const cleanParam = String(param || "").trim();

  if (!cleanParam) return `#/${encodeHashPart(cleanRoute)}`;
  return `#/${encodeHashPart(cleanRoute)}/${encodeHashPart(cleanParam)}`;
}

export function goToHash(route, param = "") {
  const nextHash = makeHash(route, param);

  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  } else {
    window.dispatchEvent(
      new CustomEvent("app_force_route_refresh", {
        detail: { route, param },
      })
    );
  }
}