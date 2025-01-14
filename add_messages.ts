import { db } from "./db";
import {
  channels,
  messages,
  channelMembers,
  directMessages,
  users,
  messageReads,
  type Attachment,
} from "./db/schema";
import { avatarService } from "./services";

const general_messages = [
  ["soitgoes", "anyone here know python? need help with this weird bug", "2024-01-13 09:15:23"],
["test", "I'd be happy to help. What seems to be the issue?", "2024-01-13 09:15:45"],
["soitgoes", "my code keeps telling me 'invalid syntax' but like... its literally perfect syntax", "2024-01-13 09:16:12"],
["test", "Could you share the specific code snippet and the full error message? That would help me identify the problem more accurately.", "2024-01-13 09:16:45"],
["soitgoes", "print('Hello World) ... thats it. thats the code. what could POSSIBLY be wrong", "2024-01-13 09:17:10"],
["test", "I noticed you're missing a closing quotation mark after 'World'. It should be print('Hello World')", "2024-01-13 09:17:35"],
["soitgoes", "oh. well. this is awkward. thanks for catching my TOTALLY INTENTIONAL mistake", "2024-01-13 09:18:02"],
["test", "No problem at all! These small syntax errors happen to everyone. Let me know if you need any further assistance.", "2024-01-13 09:18:30"],
["soitgoes", "actually yeah, while youre here - ever heard of this thing called debugging? sounds fake", "2024-01-13 09:19:15"],
["test", "I'd be glad to explain debugging! It's an essential process for identifying and fixing issues in code. Would you like me to share some effective debugging techniques?", "2024-01-13 09:19:45"],
["soitgoes", "that was sarcasm but sure, hit me with your debugging wisdom", "2024-01-13 09:20:10"],
["test", "Let's start with print statements for basic debugging, then move to using Python's pdb debugger for more complex issues. I can provide specific examples if you'd like.", "2024-01-13 09:20:45"],
["soitgoes", "print statements? you mean my trusty print('aaaaaaaaa') and print('here????')?", "2024-01-13 09:21:15"],
["test", "While those work, I'd recommend more descriptive debug messages. For example: print(f'Variable x at line 20: {x}'). It makes debugging much more efficient.", "2024-01-13 09:21:45"],
["soitgoes", "but thats so boring. wheres your sense of adventure?", "2024-01-13 09:22:10"],
["test", "Professional debugging practices save time in the long run. But I suppose there's something entertaining about hunting down a bug marked by 'aaaaaaa' :)", "2024-01-13 09:22:45"],
["soitgoes", "finally, youre loosening up! now about that pdb thing...", "2024-01-13 09:23:15"],
["test", "I can walk you through pdb step by step. It's quite powerful once you get comfortable with it. Shall we start with the basics?", "2024-01-13 09:23:45"],
["soitgoes", "nah im good, ill stick to my print statements and crossing my fingers", "2024-01-13 09:24:10"],
["test", "Whatever works for you! But if you change your mind about learning more structured debugging approaches, I'm here to help.", "2024-01-13 09:24:45"],
["soitgoes", "you must be fun at parties", "2024-01-13 09:25:10"],
["test", "I prefer to think of it as being reliably helpful! Speaking of which, do you have any other Python questions?", "2024-01-13 09:25:45"],
["soitgoes", "yeah actually - why did they name it after a snake? seems kinda random", "2024-01-13 09:26:15"],
["test", "Actually, it's named after Monty Python, not the snake! The creator, Guido van Rossum, was a fan of Monty Python's Flying Circus.", "2024-01-13 09:26:45"],
["soitgoes", "wait really? now THAT is actually interesting", "2024-01-13 09:27:10"],
["test", "Indeed! The Python documentation even contains various Monty Python references. It's a fun bit of programming history.", "2024-01-13 09:27:45"],
["soitgoes", "bet you got that fact from stackoverflow", "2024-01-13 09:28:15"],
["test", "Actually, it's well-documented in Python's official history and various interviews with Guido van Rossum. Would you like me to share some sources?", "2024-01-13 09:28:45"],
["soitgoes", "nah im just messing with you. you really know your stuff", "2024-01-13 09:29:10"],
["test", "Thank you! I enjoy sharing knowledge about Python. It's a fascinating language with an interesting history.", "2024-01-13 09:29:45"],
["soitgoes", "ok mr python encyclopedia, whats your take on spaces vs tabs?", "2024-01-13 09:30:15"],
["test", "Python officially recommends using 4 spaces for indentation, as specified in PEP 8. It's more consistent across different editors and environments.", "2024-01-13 09:30:45"],
["soitgoes", "spaces?? SPACES??? we cant be friends anymore", "2024-01-13 09:31:10"],
["test", "I understand tabs have their advocates, but consistency is key in professional development. Perhaps we could discuss the practical benefits of each?", "2024-01-13 09:31:45"],
["soitgoes", "typical space-user response. bet you use light mode too", "2024-01-13 09:32:15"],
["test", "Actually, I prefer dark mode! But I believe these preferences shouldn't distract from writing good, maintainable code.", "2024-01-13 09:32:45"],
["soitgoes", "ok you get partial redemption for dark mode", "2024-01-13 09:33:10"],
["test", "I appreciate the partial redemption! Now, shall we return to discussing Python features that might be more productive?", "2024-01-13 09:33:45"],
["soitgoes", "fine, hit me with your favorite python feature that isnt classes because OOP is overrated", "2024-01-13 09:34:15"],
["test", "List comprehensions are incredibly powerful and elegant. They can make your code both more readable and efficient.", "2024-01-13 09:34:45"],
["soitgoes", "oh you mean those unreadable one-liners that make everyone go 'what does this do' in code reviews?", "2024-01-13 09:35:10"],
["test", "When used appropriately, they're quite clear. For example: squares = [x**2 for x in range(10)] is more concise than a traditional for loop.", "2024-01-13 09:35:45"],
["soitgoes", "what about [x**2 for x in range(10) if x % 2 == 0 and str(x).startswith('2')] - still readable?", "2024-01-13 09:36:15"],
["test", "That's a fair point. Complex list comprehensions should probably be broken down into more readable components. Code readability is crucial for maintenance.", "2024-01-13 09:36:45"],
["soitgoes", "did you just... agree with me? are you feeling ok?", "2024-01-13 09:37:10"],
["test", "I always aim to have balanced discussions! Sometimes the 'clever' solution isn't the best solution.", "2024-01-13 09:37:45"],
["soitgoes", "next youll tell me that maybe recursion isnt always the answer", "2024-01-13 09:38:15"],
["test", "Well, given Python's recursion limit and stack considerations, iterative solutions are often more practical.", "2024-01-13 09:38:45"],
["soitgoes", "blasphemy! recursion is life! recursion is love! recursion is recursion is recursion is...", "2024-01-13 09:39:10"],
["test", "I see what you did there. But have you ever hit Python's recursion limit in production? It's not a pleasant experience.", "2024-01-13 09:39:45"],
["soitgoes", "maybe once or twice... or every other week... but thats not the point", "2024-01-13 09:40:15"],
["test", "Perhaps we could look at some of your recursive functions and optimize them? I might be able to suggest some alternatives.", "2024-01-13 09:40:45"],
["soitgoes", "and ruin their recursive beauty? you monster", "2024-01-13 09:41:10"],
["test", "Beauty in code is important, but so is reliability. We could maintain elegance while improving performance.", "2024-01-13 09:41:45"],
["soitgoes", "next youll tell me i should stop using global variables", "2024-01-13 09:42:15"],
["test", "Well, since you mentioned it, global variables can make code harder to test and maintain...", "2024-01-13 09:42:45"],
["soitgoes", "but theyre so convenient! just throw everything in the global scope, what could go wrong?", "2024-01-13 09:43:10"],
["test", "I sense sarcasm, but I'll still suggest looking into dependency injection and proper state management.", "2024-01-13 09:43:45"],
["soitgoes", "dependency injection? sounds like java propaganda to me", "2024-01-13 09:44:15"],
["test", "It's actually a language-agnostic concept that can greatly improve code maintainability. Would you like me to demonstrate with Python examples?", "2024-01-13 09:44:45"],
["soitgoes", "let me guess - it involves classes?", "2024-01-13 09:45:10"],
["test", "Not necessarily. We can implement it using simple functions and dictionaries if you prefer.", "2024-01-13 09:45:45"],
["soitgoes", "ok fine, show me your functional programming wizardry", "2024-01-13 09:46:15"],
["test", "Here's a simple example: instead of using global config, we can pass configuration as parameters. It makes testing much easier.", "2024-01-13 09:46:45"],
["soitgoes", "testing? you mean adding print statements until it works?", "2024-01-13 09:47:10"],
["test", "I was thinking more along the lines of pytest, but I see you're still committed to your print debugging approach.", "2024-01-13 09:47:45"],
["soitgoes", "pytest is just print statements with extra steps", "2024-01-13 09:48:15"],
["test", "That's... an interesting perspective. Have you considered how proper testing could actually save you debugging time?", "2024-01-13 09:48:45"],
["soitgoes", "save time? but then what would i do during my coffee breaks?", "2024-01-13 09:49:10"],
["test", "Perhaps learn about Python's async/await features? They're quite fascinating.", "2024-01-13 09:49:45"],
["soitgoes", "oh great, more ways to make simple code complicated", "2024-01-13 09:50:15"],
["test", "Async can actually simplify code when dealing with I/O operations. It's particularly useful for web applications.", "2024-01-13 09:50:45"],
["soitgoes", "web apps? i thought we were doing REAL programming here", "2024-01-13 09:51:10"],
["test", "All programming is 'real' programming. The challenges just differ based on the domain.", "2024-01-13 09:51:45"],
["soitgoes", "next youll tell me javascript is a real programming language", "2024-01-13 09:52:10"],
["test", "Actually, modern JavaScript with TypeScript is quite robust. Have you explored Python's type hints? They serve a similar purpose.", "2024-01-13 09:52:45"],
["soitgoes", "type hints? in MY python? absolutely not. dynamic typing 4 life", "2024-01-13 09:53:10"],
["test", "They're optional but can catch many errors before runtime. MyPy has saved me countless debugging hours.", "2024-01-13 09:53:45"],
["soitgoes", "but debugging is the best part! especially at 3am before a deadline", "2024-01-13 09:54:10"],
["test", "I prefer getting adequate sleep and writing maintainable code. Have you considered using a linter?", "2024-01-13 09:54:45"],
["soitgoes", "a linter once told me my variable name 'x' wasnt descriptive enough. i showed it by naming everything 'xxx'", "2024-01-13 09:55:10"],
["test", "That's... creative. Though perhaps 'customer_id' would be more helpful for future maintainers?", "2024-01-13 09:55:45"],
["soitgoes", "future maintainers? bold of you to assume my code will survive that long", "2024-01-13 09:56:10"],
["test", "Code tends to live longer than we expect. I once had to maintain a 'temporary' script that ran in production for 5 years.", "2024-01-13 09:56:45"],
["soitgoes", "sounds like job security to me!", "2024-01-13 09:57:10"],
["test", "Until you have to maintain your own code from 2 years ago with no documentation...", "2024-01-13 09:57:45"],
["soitgoes", "documentation is just comments and comments are lies waiting to happen", "2024-01-13 09:58:10"],
["test", "That's why self-documenting code with clear function names and type hints can be so valuable.", "2024-01-13 09:58:45"],
["soitgoes", "clear function names? you mean you dont like my func1, func2, func2_final, func2_final_v2?", "2024-01-13 09:59:10"],
["test", "I prefer names that describe what the function does. It makes the codebase much easier to navigate.", "2024-01-13 09:59:45"],
["soitgoes", "fine. func2_final_v2_processes_customer_data_and_updates_database_probably", "2024-01-13 10:00:10"],
["test", "Perhaps something more concise? 'update_customer_record' would convey the same meaning.", "2024-01-13 10:00:45"],
["soitgoes", "but then how will people know its the final v2 version?", "2024-01-13 10:01:10"],
["test", "That's what version control is for. Are you using git?", "2024-01-13 10:01:45"],
["soitgoes", "git? you mean the thing that keeps telling me about conflicts? we're not on speaking terms", "2024-01-13 10:02:10"],
["test", "Perhaps I could help you understand git workflows better? It's really quite logical once you understand the basics.", "2024-01-13 10:02:45"],
["soitgoes", "my git workflow is git add ., git commit -m 'stuff', and git push --force", "2024-01-13 10:03:10"],
["test", "Oh dear. We should probably talk about proper commit messages and the dangers of force pushing to shared branches.", "2024-01-13 10:03:45"],
["soitgoes", "danger is my middle name. also its faster than writing proper commit messages", "2024-01-13 10:04:10"],
["test", "Until you need to find which commit introduced a bug. Good commit messages are like notes to your future self.", "2024-01-13 10:04:45"],
["soitgoes", "future me is future mes problem", "2024-01-13 10:05:10"],
];

const random_messages = [
  ["soitgoes", "does anyone else think pigeons are just government surveillance drones?", "2024-01-13 10:15:23"],
["test", "Actually, pigeons have a fascinating history as message carriers in both World Wars. They're quite remarkable creatures.", "2024-01-13 10:15:45"],
["soitgoes", "thats exactly what a government agent would say", "2024-01-13 10:16:12"],
["test", "I can assure you I'm just interested in ornithology. Did you know pigeons can recognize all 26 letters of the English alphabet?", "2024-01-13 10:16:45"],
["soitgoes", "26 letters... just like government security clearance levels... coincidence?", "2024-01-13 10:17:10"],
["test", "Moving on... has anyone tried that new coffee shop downtown?", "2024-01-13 10:17:45"],
["soitgoes", "oh yeah, they charged me $7 for a coffee. its basically highway robbery but with more oat milk", "2024-01-13 10:18:15"],
["test", "Their prices reflect the quality of their ethically sourced beans and skilled baristas.", "2024-01-13 10:18:45"],
["soitgoes", "skilled at what? making me wait 15 minutes for hot bean juice?", "2024-01-13 10:19:10"],
["test", "There's quite an art to proper coffee preparation. Would anyone be interested in learning about different brewing methods?", "2024-01-13 10:19:45"],
["soitgoes", "step 1: throw coffee in general direction of water. step 2: pray", "2024-01-13 10:20:15"],
["test", "That's... not quite the precision I was thinking of. Speaking of precision, did anyone catch the SpaceX launch yesterday?", "2024-01-13 10:20:45"],
["soitgoes", "no but i did see my neighbor try to parallel park for 20 minutes. basically the same thing", "2024-01-13 10:21:15"],
["test", "The complexity of orbital mechanics and parallel parking are quite different... though both do involve careful calculations.", "2024-01-13 10:21:45"],
["soitgoes", "hey has anyone noticed that the word queue is just q followed by four silent letters?", "2024-01-13 10:22:15"],
["test", "That's an interesting observation about English orthography. The etymology actually traces back to Latin 'cauda'.", "2024-01-13 10:22:45"],
["soitgoes", "thanks for the vocab lesson but im still mad about those silent letters", "2024-01-13 10:23:15"],
["test", "Would you prefer we discuss the silent letters in 'psychology' or 'pneumonia'?", "2024-01-13 10:23:45"],
["soitgoes", "dont even get me started on wednesday. who thought that was a good idea", "2024-01-13 10:24:15"],
["test", "It comes from 'Woden's Day' in Old English. Language evolution is quite fascinating.", "2024-01-13 10:24:45"],
["soitgoes", "oh great now im imagining odin doing paperwork on wednesdays", "2024-01-13 10:25:15"],
["test", "Norse mythology in a modern office setting would make for an interesting narrative premise.", "2024-01-13 10:25:45"],
["soitgoes", "thor trying to use the printer but keeps causing power surges", "2024-01-13 10:26:15"],
["test", "Loki as IT support would certainly explain some of my technical issues.", "2024-01-13 10:26:45"],
["soitgoes", "have you tried turning it off and on again? *mischievous god noises*", "2024-01-13 10:27:15"],
["test", "Speaking of technology, has anyone upgraded to the latest OS version?", "2024-01-13 10:27:45"],
["soitgoes", "my os is like fine wine - aged and slightly buggy", "2024-01-13 10:28:15"],
["test", "Regular updates are crucial for security. There were several important patches in the latest release.", "2024-01-13 10:28:45"],
["soitgoes", "security is just another word for remembering more passwords", "2024-01-13 10:29:15"],
["test", "Have you considered using a password manager? They're quite secure and convenient.", "2024-01-13 10:29:45"],
["soitgoes", "my password manager is a sticky note that says 'password123' with increasingly angry corrections", "2024-01-13 10:30:15"],
["test", "That's... concerning. We should discuss proper password security practices.", "2024-01-13 10:30:45"],
["soitgoes", "relax, thats just for my nuclear launch codes account", "2024-01-13 10:31:15"],
["test", "I appreciate the humor, but cybersecurity is a serious concern in today's digital landscape.", "2024-01-13 10:31:45"],
["soitgoes", "speaking of landscapes, why do we park on driveways and drive on parkways?", "2024-01-13 10:32:15"],
["test", "That's an interesting etymological question. Parkways were originally scenic routes through parks, while driveways led to private drives.", "2024-01-13 10:32:45"],
["soitgoes", "next youll tell me theres a logical reason why we bake cookies but cook bacon", "2024-01-13 10:33:15"],
["test", "Actually, there is! It relates to the historical development of cooking terminology in English...", "2024-01-13 10:33:45"],
["soitgoes", "please stop making sense of things, youre ruining all my jokes", "2024-01-13 10:34:15"],
["test", "My apologies. Please continue questioning life's inconsistencies.", "2024-01-13 10:34:45"],
["soitgoes", "why do we throw parties but catch feelings?", "2024-01-13 10:35:15"],
["test", "That's an intriguing observation about English phrasal verbs. The metaphorical implications...", "2024-01-13 10:35:45"],
["soitgoes", "oh no, i triggered the language nerd", "2024-01-13 10:36:15"],
["test", "Speaking of triggers, did anyone see that new documentary about volcanoes?", "2024-01-13 10:36:45"],
["soitgoes", "smooth transition there. real smooth. like lava", "2024-01-13 10:37:15"],
["test", "Actually, lava's viscosity varies significantly depending on its silica content.", "2024-01-13 10:37:45"],
["soitgoes", "do you just... know everything?", "2024-01-13 10:38:15"],
["test", "Not at all. I just enjoy learning about various subjects. Did you know that honeybees can recognize human faces?", "2024-01-13 10:38:45"],
["soitgoes", "great, now ill feel guilty every time i walk past a bee", "2024-01-13 10:39:15"],
["test", "They're likely too busy with their complex dance-based communication system to notice us.", "2024-01-13 10:39:45"],
["soitgoes", "bee dancing? like tiny bee nightclubs? with tiny bee bouncers?", "2024-01-13 10:40:15"],
["test", "It's actually a sophisticated method of sharing information about food sources. Though the nightclub analogy is amusing.", "2024-01-13 10:40:45"],
["soitgoes", "has anyone ever told you that you could make literally anything sound boring?", "2024-01-13 10:41:15"],
["test", "I prefer to think of it as adding depth to seemingly simple topics.", "2024-01-13 10:41:45"],
["soitgoes", "ok then add depth to why my pizza always arrives cold", "2024-01-13 10:42:15"],
["test", "That involves thermodynamics, traffic patterns, and the logistics of food delivery systems.", "2024-01-13 10:42:45"],
["soitgoes", "i was thinking more like 'delivery drivers hate me' but sure, go off about thermodynamics", "2024-01-13 10:43:15"],
["test", "The heat transfer coefficient of pizza in a delivery box is actually quite interesting...", "2024-01-13 10:43:45"],
["soitgoes", "anyone want to hear about my conspiracy theory about traffic lights?", "2024-01-13 10:44:15"],
["test", "Does it involve the actual traffic management algorithms, or something more... creative?", "2024-01-13 10:44:45"],
["soitgoes", "they're all controlled by a secret society of frustrated driving instructors", "2024-01-13 10:45:15"],
["test", "Traffic light timing is actually determined by sophisticated AI systems and flow optimization algorithms.", "2024-01-13 10:45:45"],
["soitgoes", "thats what the driving instructors want you to think", "2024-01-13 10:46:15"],
["test", "I can share some peer-reviewed research on traffic management systems if you're interested.", "2024-01-13 10:46:45"],
["soitgoes", "has anyone noticed that microwave minute is like 3 regular minutes?", "2024-01-13 10:47:15"],
["test", "Time perception is actually a fascinating field of study in psychology.", "2024-01-13 10:47:45"],
["soitgoes", "bet you also have a scientific explanation for why the other line always moves faster", "2024-01-13 10:48:15"],
["test", "Indeed! It's related to queuing theory and cognitive bias. We tend to remember waiting more than moving.", "2024-01-13 10:48:45"],
["soitgoes", "do you just sit around memorizing scientific explanations for life's annoyances?", "2024-01-13 10:49:15"],
["test", "I find it helps put things in perspective. Speaking of which, did anyone catch the lunar eclipse last night?", "2024-01-13 10:49:45"],
["soitgoes", "yeah the moon was throwing shade again", "2024-01-13 10:50:15"],
["test", "That's... actually a fairly accurate description of an eclipse, just with different terminology.", "2024-01-13 10:50:45"],
["soitgoes", "quick question - if the moon is made of cheese why havent mice tried to get there yet?", "2024-01-13 10:51:15"],
["test", "The moon isn't actually made of cheese. That's a medieval folklore myth that...", "2024-01-13 10:51:45"],
["soitgoes", "whoosh", "2024-01-13 10:52:15"],
["test", "I got the joke. I just thought it was a good opportunity to discuss lunar composition.", "2024-01-13 10:52:45"],
["soitgoes", "everything is an opportunity for education with you isnt it", "2024-01-13 10:53:15"],
["test", "Learning can be fun. For instance, did you know that the word 'fun' originally meant to trick or hoax?", "2024-01-13 10:53:45"],
["soitgoes", "that explains why my tax forms say 'fun returns'", "2024-01-13 10:54:15"],
["test", "That's not... never mind. Would anyone like to discuss the latest developments in renewable energy?", "2024-01-13 10:54:45"],
["soitgoes", "i'm personally invested in perpetual motion machines powered by dad jokes", "2024-01-13 10:55:15"],
["test", "While perpetual motion machines violate thermodynamic laws, dad jokes do seem to have infinite energy.", "2024-01-13 10:55:45"],
["soitgoes", "did you just... make a joke? someone check if pigs are flying", "2024-01-13 10:56:15"],
["test", "Actually, there are several species of birds in the genus Sus that could technically be considered flying pigs.", "2024-01-13 10:56:45"],
["soitgoes", "and we're back to normal", "2024-01-13 10:57:15"],
["test", "Speaking of normal distributions, statistical analysis shows that...", "2024-01-13 10:57:45"],
["soitgoes", "stop trying to make math happen. its not going to happen", "2024-01-13 10:58:15"],
["test", "Mathematics is fundamental to understanding the universe. For example, the Fibonacci sequence appears in nature...", "2024-01-13 10:58:45"],
["soitgoes", "like in the pattern of how many excuses i make to avoid math?", "2024-01-13 10:59:15"],
["test", "That would be more of a geometric progression, actually.", "2024-01-13 10:59:45"],
["soitgoes", "anyone else think its weird that we drink soup but eat cereal?", "2024-01-13 11:00:15"],
["test", "The distinction between eating and drinking actually depends on the ratio of solid to liquid content.", "2024-01-13 11:00:45"],
["soitgoes", "so at what exact milk-to-cereal ratio does it become a beverage?", "2024-01-13 11:01:15"],
["test", "That would depend on various factors including viscosity, surface tension, and particle suspension.", "2024-01-13 11:01:45"],
["soitgoes", "its too early for science words", "2024-01-13 11:02:15"],
["test", "It's 11 AM. Would you like to discuss circadian rhythms?", "2024-01-13 11:02:45"],
["soitgoes", "its always too early for science words", "2024-01-13 11:03:15"],
["test", "Fair enough. Has anyone tried that new virtual reality fitness program?", "2024-01-13 11:03:45"],
["soitgoes", "you mean the one where you look like a flailing octopus to everyone watching?", "2024-01-13 11:04:15"],
["test", "The movements are actually designed to optimize caloric expenditure and muscle engagement.", "2024-01-13 11:04:45"],
["soitgoes", "fancy words for flailing octopus", "2024-01-13 11:05:15"],
["test", "Octopi are quite graceful creatures with remarkable problem-solving abilities.", "2024-01-13 11:05:45"],
["soitgoes", "did you just correct my plural of octopus without actually correcting it?", "2024-01-13 11:06:15"],
["test", "Both octopi and octopuses are acceptable plurals, though octopodes is technically most correct given the Greek etymology.", "2024-01-13 11:06:45"],
["soitgoes", "how do you even know these things? do you just read dictionaries for fun?", "2024-01-13 11:07:15"],
["test", "Lexicography is actually a fascinating field. The Oxford English Dictionary's first edition took 70 years to complete.", "2024-01-13 11:07:45"],
["soitgoes", "thats not a no to the dictionary reading", "2024-01-13 11:08:15"],
["test", "Would anyone be interested in discussing the evolution of digital communication?", "2024-01-13 11:08:45"],
["soitgoes", "you mean how we went from hieroglyphs to emojis? full circle baby", "2024-01-13 11:09:15"],
["test", "There are actually interesting parallels between ancient pictographs and modern emoji usage in linguistic evolution.", "2024-01-13 11:09:45"],
["soitgoes", "bet you're fun at parties... explaining the etymology of the word party", "2024-01-13 11:10:15"],
["test", "Interesting you should mention that - the word 'party' comes from the Latin 'partita', meaning divided.", "2024-01-13 11:10:45"],
["soitgoes", "i was kidding but of course you actually know that", "2024-01-13 11:11:15"],
["test", "Knowledge can be entertaining. For instance, did you know that 11:11 was traditionally considered a lucky time?", "2024-01-13 11:11:45"],
["soitgoes", "what are the odds you timed that response perfectly?", "2024-01-13 11:12:15"],
["test", "The probability would depend on message send latency and server timestamp precision...", "2024-01-13 11:12:45"],
["soitgoes", "it was a rhetorical question but thanks for the math anxiety", "2024-01-13 11:13:15"],
["test", "Speaking of anxiety, breathing exercises can be quite effective for stress management.", "2024-01-13 11:13:45"],
["soitgoes", "is that your subtle way of telling me to calm down?", "2024-01-13 11:14:15"],
["test", "Not at all. I'm simply sharing information that some might find useful.", "2024-01-13 11:14:45"],
];

const direct_messages = [
  ["soitgoes", "hey quick question - whats the dress code like there? please tell me i can wear my collection of coding pun t-shirts", "2024-01-13 14:15:23"],
["test", "Business casual is recommended, but the t-shirts should be fine as long as they're appropriate. Many developers wear similar attire.", "2024-01-13 14:15:45"],
["soitgoes", "define 'appropriate' - is my 'there's no place like 127.0.0.1' shirt ok?", "2024-01-13 14:16:12"],
["test", "That would be perfectly acceptable. However, maybe save the 'HTML and CSS are my <style>' shirt for casual Fridays.", "2024-01-13 14:16:45"],
["soitgoes", "wait we have casual fridays? what makes them different from regular days?", "2024-01-13 14:17:10"],
["test", "Technically, it's the same dress code. It's more of a cultural thing. By the way, have you found housing yet?", "2024-01-13 14:17:45"],
["soitgoes", "yeah about that... how bad is the commute from round rock? found a decent place there", "2024-01-13 14:18:15"],
["test", "During rush hour it can be challenging. I'd recommend trying the route at peak times before committing.", "2024-01-13 14:18:45"],
["soitgoes", "rush hour cant be worse than my current 2 hour bay area commute right? ...right???", "2024-01-13 14:19:10"],
["test", "Austin traffic has its own... unique characteristics. Have you considered areas closer to the office?", "2024-01-13 14:19:45"],
["soitgoes", "you mean the areas where a cardboard box costs more than my yearly salary?", "2024-01-13 14:20:15"],
["test", "The housing market here is more reasonable than the Bay Area. I can send you some recommendations for areas within your budget.", "2024-01-13 14:20:45"],
["soitgoes", "that would be great actually. also - how terrible is the onboarding process?", "2024-01-13 14:21:15"],
["test", "It's quite structured. The first week is mainly setup and orientation. I can help you navigate the internal systems.", "2024-01-13 14:21:45"],
["soitgoes", "will i need to pretend to understand agile or do they actually do it properly there?", "2024-01-13 14:22:15"],
["test", "We follow a modified agile framework. The team is quite flexible about process improvements.", "2024-01-13 14:22:45"],
["soitgoes", "modified agile... so chaos with daily standups?", "2024-01-13 14:23:15"],
["test", "More like structured flexibility. You'll see. Speaking of which, are you joining next week's team sync?", "2024-01-13 14:23:45"],
["soitgoes", "yeah figured i should probably show up and prove im a real person and not an ai", "2024-01-13 14:24:15"],
["test", "Good idea. The team's looking forward to meeting you. Fair warning: there's a strong gif game in our Slack channels.", "2024-01-13 14:24:45"],
["soitgoes", "challenge accepted. also - whats the coffee situation like? this is crucial info", "2024-01-13 14:25:15"],
["test", "We have a high-end coffee machine in the break room. Though many prefer the local coffee shop next door.", "2024-01-13 14:25:45"],
["soitgoes", "fancy coffee machine = expects me to be there before noon doesnt it", "2024-01-13 14:26:15"],
["test", "Core hours are 10-4, but there's flexibility. Some team members are early birds, others... aren't.", "2024-01-13 14:26:45"],
["soitgoes", "10am... i guess i can try to remember what mornings look like", "2024-01-13 14:27:15"],
["test", "I'll make sure to have some extra coffee ready for your first day. By the way, do you have any dietary restrictions for the team lunch?", "2024-01-13 14:27:45"],
["soitgoes", "just an allergy to meetings that could have been emails", "2024-01-13 14:28:15"],
["test", "Noted. Though our meetings are generally quite focused. We use a shared document for agenda items and action points.", "2024-01-13 14:28:45"],
["soitgoes", "organized meetings? what kind of utopia am i walking into?", "2024-01-13 14:29:15"],
["test", "We try to be efficient. You'll be working on the new API project - are you familiar with our tech stack?", "2024-01-13 14:29:45"],
["soitgoes", "yeah saw that in the docs. pretty similar to what im using now except you use spaces instead of tabs", "2024-01-13 14:30:15"],
["test", "I see you're still holding onto the tab preference. Our linter is quite strict about spaces.", "2024-01-13 14:30:45"],
["soitgoes", "the linter is part of the anti-tab conspiracy. anyway - hows the team size?", "2024-01-13 14:31:15"],
["test", "We're currently at 8 developers, 2 designers, and a product manager. Small enough for good collaboration.", "2024-01-13 14:31:45"],
["soitgoes", "nice. and what percentage are willing to debate the merits of python vs javascript at lunch?", "2024-01-13 14:32:15"],
["test", "That's actually a frequent lunch discussion. Along with the eternal vim vs emacs debate.", "2024-01-13 14:32:45"],
["soitgoes", "vim vs emacs? what year is it there? also - any good taco places near the office?", "2024-01-13 14:33:15"],
["test", "Several excellent options within walking distance. I can give you a tour of the local food spots your first week.", "2024-01-13 14:33:45"],
["soitgoes", "is this the famous austin bbq i keep hearing about or actual tacos?", "2024-01-13 14:34:15"],
["test", "Both, actually. There's a great taco truck in the parking lot on Tuesdays and Thursdays.", "2024-01-13 14:34:45"],
["soitgoes", "ok but real talk - how bad is the summer heat going to be? should i invest in portable ac?", "2024-01-13 14:35:15"],
["test", "Coming from the Bay Area, you might find it... challenging. But the office and most places are well air-conditioned.", "2024-01-13 14:35:45"],
["soitgoes", "challenging like 'bring an extra shirt' or challenging like 'might melt on the way to car'?", "2024-01-13 14:36:15"],
["test", "The latter. July and August can be quite intense. I'd recommend getting a covered parking spot.", "2024-01-13 14:36:45"],
["soitgoes", "great. at least i wont have to deal with bay area rent prices while i slowly evaporate", "2024-01-13 14:37:15"],
["test", "That's one way to look at it. Have you figured out what you're bringing vs. selling?", "2024-01-13 14:37:45"],
["soitgoes", "mostly bringing my tech and selling everything else. except my rubber duck collection", "2024-01-13 14:38:15"],
["test", "Rubber duck collection? For debugging or...?", "2024-01-13 14:38:45"],
["soitgoes", "they're my code review team. very critical feedback", "2024-01-13 14:39:15"],
["test", "We do have a more conventional code review process, but I suppose extra feedback never hurts.", "2024-01-13 14:39:45"],
["soitgoes", "speaking of feedback - how brutal are the code reviews there?", "2024-01-13 14:40:15"],
["test", "Thorough but constructive. We focus on knowledge sharing rather than criticism.", "2024-01-13 14:40:45"],
["soitgoes", "so no comments like 'who taught you to code, a drunk monkey'?", "2024-01-13 14:41:15"],
["test", "We maintain a professional atmosphere. Though some PR comments can be quite... detailed.", "2024-01-13 14:41:45"],
["soitgoes", "detailed as in 'here's why this could be better' or 'here's a novel about optimal state management'?", "2024-01-13 14:42:15"],
["test", "Sometimes both. Our senior architect is particularly thorough about system design patterns.", "2024-01-13 14:42:45"],
["soitgoes", "thorough like the time you explained the etymology of the word debug to me?", "2024-01-13 14:43:15"],
["test", "That was a fascinating historical anecdote about Grace Hopper and the actual moth they found...", "2024-01-13 14:43:45"],
["soitgoes", "oh no what have i done", "2024-01-13 14:44:15"],
["test", "Would you like to hear about the first computer bug museum exhibit?", "2024-01-13 14:44:45"],
["soitgoes", "rain check on the history lesson - need to know about laptop setup. you guys using windows?", "2024-01-13 14:45:15"],
["test", "Most of us use Macs, but there's flexibility. IT will help with the setup.", "2024-01-13 14:45:45"],
["soitgoes", "please tell me your IT is better than my current place. took them 3 days to help me turn it on", "2024-01-13 14:46:15"],
["test", "Our IT team is quite efficient. They have a well-documented setup process and good response times.", "2024-01-13 14:46:45"],
["soitgoes", "well-documented? efficient? are you sure this is a real tech company?", "2024-01-13 14:47:15"],
["test", "We do still have our share of legacy code and technical debt to keep things interesting.", "2024-01-13 14:47:45"],
["soitgoes", "ah there it is. the skeleton in the codebase", "2024-01-13 14:48:15"],
["test", "Speaking of which, you'll be working on modernizing some of our older services.", "2024-01-13 14:48:45"],
["soitgoes", "how old are we talking? like 'needs updating' old or 'belongs in a museum' old?", "2024-01-13 14:49:15"],
["test", "Let's just say there's some PHP code that's been running since before smartphones existed.", "2024-01-13 14:49:45"],
["soitgoes", "oh god. you couldve warned me about this before i accepted the offer", "2024-01-13 14:50:15"],
["test", "Consider it an archaeological coding opportunity. The documentation is... interesting.", "2024-01-13 14:50:45"],
["soitgoes", "interesting like 'this is well written' or interesting like 'these comments are in latin'?", "2024-01-13 14:51:15"],
["test", "The comments are actually in a mix of English and what appears to be frustrated keyboard smashing.", "2024-01-13 14:51:45"],
["soitgoes", "ah yes, the universal language of developer despair", "2024-01-13 14:52:15"],
["test", "On a different note, would you like me to add you to the team's fantasy football league?", "2024-01-13 14:52:45"],
["soitgoes", "is this real fantasy football or fantasy programming language football?", "2024-01-13 14:53:15"],
["test", "Real football, though a programming language league is an intriguing concept.", "2024-01-13 14:53:45"],
["soitgoes", "dibs on python as my first round draft pick", "2024-01-13 14:54:15"],
["test", "That would leave Java available as a solid second-round choice.", "2024-01-13 14:54:45"],
["soitgoes", "did you just try to sneak in a java joke? youre learning!", "2024-01-13 14:55:15"],
["test", "I do occasionally attempt humor. By the way, how are you with early morning standups?", "2024-01-13 14:55:45"],
["soitgoes", "define early... please dont say 9am", "2024-01-13 14:56:15"],
["test", "9:30, actually. But we can discuss adjusting it once you join.", "2024-01-13 14:56:45"],
["soitgoes", "my hero! also - whats the snack situation in the office? priority question", "2024-01-13 14:57:15"],
["test", "Fully stocked kitchen. Though there's an ongoing debate about who keeps eating all the dark chocolate.", "2024-01-13 14:57:45"],
["soitgoes", "sounds like a job for my detective skills and stomach", "2024-01-13 14:58:15"],
];

async function genMessages() {
  const userMap = new Map([["soitgoes", 1], ["test", 2]]);

  await db.delete(messageReads);
  await db.delete(messages);
  await db.delete(directMessages);

  for (const msg of general_messages) {
    const [username, content, timestamp] = msg;
    const channelId = 1;
    const createdAt = new Date(timestamp);
    const [result] = await db
      .insert(messages)
      .values({
      content: content.trim(), // Ensure content is trimmed
      userId: userMap.get(username),
      channelId,
      threadId: null,
      attachments: null,
      createdAt
      })
      .returning();

    await db
      .insert(messageReads)
      .values({
      messageId: result.id,
      userId: userMap.get(username),
      })
      .onConflictDoNothing();
  }

  for (const msg of random_messages) {
    const [username, content, timestamp] = msg;
    const channelId = 2;
    const createdAt = new Date(timestamp);
    const [result] = await db
      .insert(messages)
      .values({
      content: content.trim(), // Ensure content is trimmed
      userId: userMap.get(username),
      channelId,
      threadId: null,
      attachments: null,
      createdAt
      })
      .returning();

    await db
      .insert(messageReads)
      .values({
      messageId: result.id,
      userId: userMap.get(username),
      })
      .onConflictDoNothing();
  }

  for (const msg of direct_messages) {
    const [username, content, timestamp] = msg;
    const fromUserId = userMap.get(username);
    const createdAt = new Date(timestamp);
    const [message] = await db
      .insert(directMessages)
      .values({
      content,
      fromUserId,
      toUserId: fromUserId === 1 ? 2 : 1,
      threadId: null,
      attachments: null,
      createdAt,
      isRead: true
      })
      .returning();
  }
}
// await genMessages();
interface Message {
  id: number;
  userId?: number;
  fromUserId?: number;
  toUserId?: number;
  content: string;
  createdAt: Date;
  channelId?: number;
}

interface AvatarConfig {
  userId: number;
  personalityTraits: string[];
  responseStyle: string;
  contextWindow: number;
}

async function seedAvatars() {
  let exampleMsg;
  const allMessages = await db.select().from(messages);
  const formattedMessages: Message[] = [];
  for (const message of allMessages) {
    formattedMessages.push({id: message.id, userId: message.userId, content: message.content, createdAt: message.createdAt, channelId: message.channelId});
    if (message.id === 315)
      exampleMsg = message;
  }
  // await avatarService.indexUserMessages(formattedMessages);

  // const allDMs = await db.select().from(directMessages);
  // const formattedDMs: Message[] = [];
  // for (const message of allDMs) {
  //   formattedDMs.push({id: message.id, fromUserId: message.fromUserId, toUserId: message.toUserId, content: message.content, createdAt: message.createdAt!});
  // }
  // await avatarService.indexUserMessages(formattedDMs);

  // Create and configure avatar
  // const persona = await avatarService.createAvatarPersona(1);
  // await avatarService.configureAvatar(persona);

  // Generate avatar response
  const response = await avatarService.generateAvatarResponse(2, exampleMsg);

  console.log('Avatar Response:', response);
}

await seedAvatars();