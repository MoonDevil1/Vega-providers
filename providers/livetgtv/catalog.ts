export const catalog = [
  { title: "All Live Channels", filter: "all" },
  { title: "News", filter: "group:News" },
  { title: "Sports", filter: "group:Sports" },
  { title: "Entertainment", filter: "group:Entertainment" },
  { title: "Movies", filter: "group:Movies" },
];

export const genres = [
  "24/7 kids+Goldmines pack", "Assamese", "Bangla", "Bengali", "Bhojpuri",
  "Business News", "Devotional", "Dangal Play", "Educational", "English",
  "Entertainment", "FanCode", "French", "Gujarati", "Infotainment",
  "Jiotvstb+", "JioHotstar", "Kannada", "Kids", "Lifestyle", "LIVE SPORTS | STREAMX",
  "Malayalam", "Marathi", "Movies", "Music", "Nepali", "News", "Odia",
  "Punjabi", "Prime video Events", "Sonyliv", "Sonyliv events", "Sports",
  "SunNXT", "Tamil", "Telugu", "Unknown", "Urdu", "VZY", "Willow live events",
  "WOW KIDZ", "ZEE5 India", "ZEE5 Worldwide",
].map((group) => ({ title: group, filter: "group:" + group }));
