/**
 * Word pool for the drawing game
 * Organized by difficulty and category for balanced gameplay
 */

const WORDS = {
  easy: [
    // Common objects
    'apple', 'book', 'car', 'dog', 'eye', 'fish', 'gun', 'hat', 'ice', 'jam',
    'key', 'lamp', 'moon', 'nose', 'owl', 'pen', 'queen', 'rain', 'sun', 'tree',
    'umbrella', 'van', 'water', 'box', 'yard', 'zebra', 'ball', 'cat', 'door', 'egg',
    'fire', 'glass', 'hand', 'island', 'juice', 'kite', 'leaf', 'mouse', 'nail', 'ocean',
    'pizza', 'rabbit', 'star', 'table', 'up', 'violin', 'window', 'x-ray', 'yellow', 'zoo',

    // Body parts
    'head', 'arm', 'leg', 'foot', 'hair', 'ear', 'mouth', 'tooth', 'finger', 'knee',

    // Food
    'bread', 'cheese', 'milk', 'cake', 'cookie', 'banana', 'orange', 'grape', 'chicken', 'rice',

    // Animals
    'bird', 'bear', 'lion', 'tiger', 'elephant', 'horse', 'cow', 'pig', 'sheep', 'duck'
  ],

  medium: [
    // Actions
    'running', 'jumping', 'swimming', 'dancing', 'singing', 'cooking', 'reading', 'writing', 'sleeping', 'laughing',
    'crying', 'walking', 'flying', 'climbing', 'driving', 'painting', 'drawing', 'thinking', 'dreaming', 'working',

    // Objects
    'telescope', 'computer', 'bicycle', 'airplane', 'helicopter', 'submarine', 'castle', 'bridge', 'lighthouse', 'windmill',
    'robot', 'dinosaur', 'skeleton', 'volcano', 'rainbow', 'tornado', 'spaceship', 'treasure', 'crown', 'sword',

    // Concepts
    'birthday', 'vacation', 'school', 'hospital', 'restaurant', 'library', 'museum', 'garden', 'forest', 'beach',
    'mountain', 'desert', 'jungle', 'city', 'village', 'farm', 'park', 'circus', 'theater', 'concert',

    // Professions
    'doctor', 'teacher', 'police', 'firefighter', 'chef', 'artist', 'musician', 'dancer', 'pilot', 'sailor'
  ],

  hard: [
    // Abstract concepts
    'democracy', 'philosophy', 'psychology', 'evolution', 'gravity', 'electricity', 'magnetism', 'photosynthesis', 'ecosystem', 'civilization',
    
    // Complex objects
    'architecture', 'archaeology', 'astronomy', 'meteorology', 'geography', 'biography', 'mythology', 'technology', 'laboratory', 'observatory',
    
    // Emotions and states
    'nostalgia', 'melancholy', 'euphoria', 'anxiety', 'serenity', 'confusion', 'determination', 'curiosity', 'jealousy', 'confidence',
    
    // Activities
    'meditation', 'negotiation', 'investigation', 'celebration', 'communication', 'transportation', 'organization', 'imagination', 'inspiration', 'innovation',
    
    // Compound concepts
    'friendship', 'leadership', 'championship', 'relationship', 'partnership', 'scholarship', 'citizenship', 'ownership', 'membership', 'apprenticeship'
  ]
};

/**
 * Get a random selection of words for the player to choose from
 * @param {number} count - Number of words to return (default: 3)
 * @param {string} difficulty - Difficulty level ('easy', 'medium', 'hard', 'mixed')
 * @returns {string[]} Array of random words
 */
function getRandomWords(count = 3, difficulty = 'mixed') {
  let wordPool = [];
  
  if (difficulty === 'mixed') {
    // Mix of difficulties for balanced gameplay
    wordPool = [
      ...WORDS.easy.slice(0, 20),      // 20 easy words
      ...WORDS.medium.slice(0, 15),    // 15 medium words  
      ...WORDS.hard.slice(0, 5)        // 5 hard words
    ];
  } else if (WORDS[difficulty]) {
    wordPool = WORDS[difficulty];
  } else {
    // Default to mixed if invalid difficulty
    wordPool = [...WORDS.easy, ...WORDS.medium, ...WORDS.hard];
  }
  
  // Shuffle the pool and return the requested count
  const shuffled = wordPool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Get word difficulty level
 * @param {string} word - The word to check
 * @returns {string} Difficulty level
 */
function getWordDifficulty(word) {
  if (WORDS.easy.includes(word)) return 'easy';
  if (WORDS.medium.includes(word)) return 'medium';
  if (WORDS.hard.includes(word)) return 'hard';
  return 'unknown';
}

/**
 * Calculate points based on word difficulty
 * @param {string} word - The word that was guessed
 * @returns {number} Points to award
 */
function calculateWordPoints(word) {
  const difficulty = getWordDifficulty(word);
  switch (difficulty) {
    case 'easy': return 10;
    case 'medium': return 15;
    case 'hard': return 25;
    default: return 10;
  }
}

module.exports = {
  WORDS,
  getRandomWords,
  getWordDifficulty,
  calculateWordPoints
}; 