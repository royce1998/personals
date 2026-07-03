'use strict';

// Personal ad categories (mirrors the classic Craigslist Personals sections)
const CATEGORIES = [
  { slug: 'strictly-platonic', name: 'Strictly Platonic' },
  { slug: 'women-seeking-women', name: 'Women Seeking Women' },
  { slug: 'women-seeking-men', name: 'Women Seeking Men' },
  { slug: 'men-seeking-women', name: 'Men Seeking Women' },
  { slug: 'men-seeking-men', name: 'Men Seeking Men' },
  { slug: 'misc-romance', name: 'Misc Romance' },
  { slug: 'casual-encounters', name: 'Casual Encounters' },
  { slug: 'missed-connections', name: 'Missed Connections' },
  { slug: 'rants-and-raves', name: 'Rants & Raves' },
];

const CATEGORY_SLUGS = new Set(CATEGORIES.map((c) => c.slug));

// A starter list of cities/regions. Users can also type a free-form location.
const CITIES = [
  'Atlanta', 'Austin', 'Boston', 'Chicago', 'Dallas', 'Denver', 'Detroit',
  'Houston', 'Las Vegas', 'Los Angeles', 'Miami', 'Minneapolis', 'Nashville',
  'New York', 'Philadelphia', 'Phoenix', 'Portland', 'San Diego',
  'San Francisco', 'Seattle', 'Washington DC', 'Other',
];

const CONFIG = {
  POST_EXPIRY_DAYS: 30, // posts auto-expire after this many days
  FLAG_HIDE_THRESHOLD: 4, // auto-hide a post once it reaches this many flags
  MAX_IMAGES_PER_POST: 6,
  MAX_IMAGE_BYTES: 5 * 1024 * 1024, // 5 MB per image
  PAGE_SIZE: 20,
  MIN_AGE: 18,
  MAX_AGE: 120,
  TITLE_MAX: 120,
  BODY_MAX: 8000,
  BCRYPT_ROUNDS: 10,
};

module.exports = { CATEGORIES, CATEGORY_SLUGS, CITIES, CONFIG };
