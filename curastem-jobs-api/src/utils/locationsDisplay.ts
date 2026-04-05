/**
 * Build display-friendly location strings: ATS data often has city/state without country;
 * when job_country (ISO-2) is known, append a region name if the string does not already include it.
 */
export function enrichLocationsWithCountry(
  locations: string[] | null,
  jobCountry: string | null
): string[] | null {
  if (!locations?.length || !jobCountry) return locations;
  const iso = jobCountry.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  if (iso.length !== 2) return locations;

  let regionName: string;
  try {
    regionName =
      new Intl.DisplayNames(["en"], { type: "region" }).of(iso) ?? iso;
  } catch {
    regionName = iso;
  }

  return locations.map((loc) => {
    const t = loc.trim();
    if (!t || /^remote$/i.test(t)) return loc;
    const lower = t.toLowerCase();
    if (lower.includes(iso.toLowerCase())) return loc;
    if (regionName && lower.includes(regionName.toLowerCase())) return loc;
    // Typical US postings already imply country
    if (iso === "US" && /,\s*[A-Z]{2}\s*$/.test(t)) return loc;
    return `${t}, ${regionName}`;
  });
}
