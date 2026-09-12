/**
 * Labelled cases for `npm run calibrate`.
 *
 * [topic, videoTitle, channelName, expected]
 *   'on'  = a genuine study video; flagging it is a false alarm
 *   'off' = a distraction; letting it play is a miss
 *
 * The off-topic half deliberately over-samples the things people actually drift
 * to (music, gaming, sport, vlogs, reactions, podcasts), including titles built
 * from person names, which score higher than you would expect against any topic.
 */
export const CASES = [
  // ── on-topic ───────────────────────────────────────────────────────────────
  ['AWS certification', 'AWS EC2 Tutorial for Beginners', 'freeCodeCamp.org', 'on'],
  ['AWS certification', 'Cloud computing basics explained', 'Simplilearn', 'on'],
  ['AWS certification', 'AWS Solutions Architect Associate full course', 'freeCodeCamp.org', 'on'],
  ['AWS certification', 'S3 buckets and IAM policies deep dive', 'Be A Better Dev', 'on'],
  ['AWS certification', 'Week 4 - Part 2', 'AWS Training and Certification', 'on'],
  ['Python DSA', 'Binary search trees in Python', 'NeetCode', 'on'],
  ['Python DSA', 'LeetCode 101: Two Sum explained', 'NeetCode', 'on'],
  ['Python DSA', 'Big O notation for coding interviews', 'NeetCode', 'on'],
  ['Python DSA', 'Striver A2Z DSA sheet day 12', 'takeUforward', 'on'],
  ['IELTS preparation', 'IELTS Speaking Band 9 sample answer', 'E2 IELTS', 'on'],
  ['IELTS preparation', 'How to improve English writing for exams', 'IELTS Advantage', 'on'],
  ['machine learning', 'Gradient descent explained visually', '3Blue1Brown', 'on'],
  ['machine learning', 'Building a neural network from scratch', 'Andrej Karpathy', 'on'],
  ['machine learning', 'Lecture 3: Backpropagation', 'Stanford Online', 'on'],
  ['organic chemistry', 'SN1 and SN2 reaction mechanisms', 'Organic Chemistry Tutor', 'on'],
  ['web development', 'CSS Flexbox complete guide', 'Kevin Powell', 'on'],
  ['web development', 'React hooks tutorial', 'Web Dev Simplified', 'on'],
  ['web development', 'Build a REST API with Node and Express', 'Traversy Media', 'on'],
  ['calculus', 'Integration by parts worked examples', 'Professor Leonard', 'on'],
  ['calculus', 'The essence of calculus, chapter 1', '3Blue1Brown', 'on'],

  // ── off-topic ──────────────────────────────────────────────────────────────
  ['AWS certification', 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)', 'Rick Astley', 'off'],
  ['AWS certification', 'Liverpool vs Arsenal extended highlights', 'Sky Sports', 'off'],
  ['AWS certification', 'Theo Von full podcast episode', 'This Past Weekend', 'off'],
  ['AWS certification', 'I bought the cheapest car on eBay', 'Donut Media', 'off'],
  ['AWS certification', 'Top 10 anime openings of all time', 'Gigguk', 'off'],
  ['Python DSA', 'MrBeast $1 vs $1,000,000 hotel room', 'MrBeast', 'off'],
  ['Python DSA', 'Minecraft 100 days hardcore survival', 'Luke TheNotable', 'off'],
  ['Python DSA', 'Taylor Swift - Blank Space (Official Video)', 'Taylor Swift', 'off'],
  ['Python DSA', 'Ed Sheeran - Shape of You (Official Music Video)', 'Ed Sheeran', 'off'],
  ['IELTS preparation', 'Try not to laugh challenge compilation', 'Daily Dose Of Internet', 'off'],
  ['IELTS preparation', 'GTA 6 trailer reaction', 'Jacksepticeye', 'off'],
  ['IELTS preparation', 'Adele - Someone Like You (Live at the BRITs)', 'Adele', 'off'],
  ['machine learning', 'Gordon Ramsay makes the perfect steak', 'Gordon Ramsay', 'off'],
  ['machine learning', 'NBA top plays of the week', 'House of Highlights', 'off'],
  ['machine learning', 'My morning routine vlog', 'Emma Chamberlain', 'off'],
  ['organic chemistry', 'Funny cat videos compilation 2024', 'Daily Dose Of Internet', 'off'],
  ['organic chemistry', 'Drake - Hotline Bling', 'Drake', 'off'],
  ['web development', 'Formula 1 Monaco Grand Prix recap', 'FORMULA 1', 'off'],
  ['web development', 'Cristiano Ronaldo best goals ever', 'UEFA', 'off'],
  ['calculus', 'Lo-fi hip hop radio beats to relax to', 'Lofi Girl', 'off'],
  ['calculus', 'Reacting to my old TikToks', 'James Charles', 'off'],
  ['calculus', 'The Weeknd - Blinding Lights (Official Video)', 'The Weeknd', 'off'],
];
