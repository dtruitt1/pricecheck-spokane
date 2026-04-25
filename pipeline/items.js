/**
 * items.js — canonical staples basket definition
 *
 * item_key:    snake_case stable identifier, never changes
 * item_name:   display name
 * unit:        canonical unit for price comparison
 * walmart_q:   search query to use against Walmart API
 * aliases:     keywords that should map to this item_key
 *              (used by the ad parser to match extracted product names)
 */

export const STAPLES = [
  {
    item_key:  'milk_whole_gallon',
    item_name: 'Whole milk',
    unit:      'gal',
    walmart_q: 'whole milk 1 gallon',
    aliases:   ['whole milk', 'vitamin d milk', 'homogenized milk'],
  },
  {
    item_key:  'eggs_large_dozen',
    item_name: 'Large eggs',
    unit:      'doz',
    walmart_q: 'large eggs 12 count',
    aliases:   ['large eggs', 'grade a eggs', 'dozen eggs', 'eggs 12 ct'],
  },
  {
    item_key:  'ground_beef_8020_lb',
    item_name: 'Ground beef 80/20',
    unit:      'lb',
    walmart_q: 'ground beef 80/20 lean',
    aliases:   ['ground beef', '80/20', '80% lean', 'hamburger meat'],
  },
  {
    item_key:  'chicken_breast_lb',
    item_name: 'Boneless chicken breast',
    unit:      'lb',
    walmart_q: 'boneless skinless chicken breast',
    aliases:   ['chicken breast', 'boneless chicken', 'skinless chicken breast'],
  },
  {
    item_key:  'bread_white_loaf',
    item_name: 'White sandwich bread',
    unit:      'loaf',
    walmart_q: 'white sandwich bread loaf',
    aliases:   ['white bread', 'sandwich bread', 'sliced bread'],
  },
  {
    item_key:  'butter_salted_lb',
    item_name: 'Butter, salted',
    unit:      'lb',
    walmart_q: 'salted butter 1 pound',
    aliases:   ['butter', 'salted butter', 'sweet cream butter'],
  },
  {
    item_key:  'cheddar_cheese_lb',
    item_name: 'Cheddar cheese',
    unit:      'lb',
    walmart_q: 'cheddar cheese block 16 oz',
    aliases:   ['cheddar cheese', 'medium cheddar', 'sharp cheddar', 'cheddar block'],
  },
  {
    item_key:  'bananas_lb',
    item_name: 'Bananas',
    unit:      'lb',
    walmart_q: 'bananas fresh',
    aliases:   ['bananas', 'banana'],
  },
  {
    item_key:  'potatoes_russet_5lb',
    item_name: 'Russet potatoes',
    unit:      '5 lb bag',
    walmart_q: 'russet potatoes 5 pound bag',
    aliases:   ['russet potatoes', 'potatoes 5 lb', 'idaho potatoes', 'baking potatoes'],
  },
  {
    item_key:  'toilet_paper_12pk',
    item_name: 'Toilet paper',
    unit:      '12-ct',
    walmart_q: 'toilet paper 12 rolls double roll',
    aliases:   ['toilet paper', 'bath tissue', 'toilet tissue', 'bathroom tissue'],
  },
  {
    item_key:  'paper_towels_6pk',
    item_name: 'Paper towels',
    unit:      '6-ct',
    walmart_q: 'paper towels 6 rolls select-a-size',
    aliases:   ['paper towels', 'kitchen towels', 'bounty', 'paper towel rolls'],
  },
  {
    item_key:  'pasta_spaghetti_16oz',
    item_name: 'Spaghetti pasta',
    unit:      '16 oz',
    walmart_q: 'spaghetti pasta 16 oz',
    aliases:   ['spaghetti', 'pasta', 'spaghetti noodles', '1 lb pasta'],
  },
  {
    item_key:  'canola_oil_48oz',
    item_name: 'Canola oil',
    unit:      '48 oz',
    walmart_q: 'canola oil 48 oz',
    aliases:   ['canola oil', 'vegetable oil', 'cooking oil 48 oz'],
  },
  {
    item_key:  'orange_juice_52oz',
    item_name: 'Orange juice',
    unit:      '52 oz',
    walmart_q: 'orange juice 52 oz not from concentrate',
    aliases:   ['orange juice', 'oj', 'tropicana', 'simply orange', 'minute maid oj'],
  },
];

/**
 * Given an extracted product name from a weekly ad,
 * return the matching STAPLES item or null.
 * Uses lowercase substring matching on aliases.
 */
export function matchItemKey(extractedName) {
  const lower = extractedName.toLowerCase();
  for (const item of STAPLES) {
    if (item.aliases.some(alias => lower.includes(alias))) {
      return item;
    }
  }
  return null;
}
