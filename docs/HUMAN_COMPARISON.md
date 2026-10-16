# Comparison to human research

Generated from `src/research/human.js`. Every citation is marked **verify**: it was written from memory and has not been checked against the original source. Change a mark only after reading the source, and record the link here.

Each Stebula finding names one of these areas, and the Findings tab shows the matching panel. The comparison is a way to ask good questions, not a claim that Stebula and humans are alike.

## Self-recognition (`self-recognition`)

**What humans show.** Children begin to recognize themselves in a mirror around 18 to 24 months. Some other great apes pass a similar mark test; most animals do not.

**What Stebula shows.** Stebula has no body or mirror. The nearest analog is self-prediction: it predicts what a fresh copy of itself will say, and code scores the prediction.

**The key difference.** Mirror tests ask whether a body is recognized. Self-prediction tests whether a description of itself matches its behavior. Passing one says nothing about the other.

**Citations (all verify):**
- Gallup 1970, "Chimpanzees: self-recognition", Science 167:86 (verify)
- Amsterdam 1972, "Mirror self-image reactions before age two", Developmental Psychobiology 5:297 (verify)

## Theory of mind (`theory-of-mind`)

**What humans show.** Children typically pass false-belief tasks, which require tracking what another person believes, around age 4.

**What Stebula shows.** Stebula keeps a short written model of the person (person_model). It is not yet tested on false-belief style tasks.

**The key difference.** Language models can pass text versions of false-belief tasks by pattern. Passing a task is not evidence of the developmental process that produces it in children.

**Citations (all verify):**
- Premack and Woodruff 1978, "Does the chimpanzee have a theory of mind?", Behavioral and Brain Sciences 1:515 (verify)
- Wimmer and Perner 1983, Cognition 13:103 (verify)
- Baron-Cohen, Leslie and Frith 1985, Cognition 21:37 (verify)

## Inner speech (`inner-speech`)

**What humans show.** In the Vygotskian account, inner speech develops from social speech turned inward. Adults report varied amounts and kinds of inner speech.

**What Stebula shows.** Its candidate thoughts are text written in a separate model call before it answers. They are logged and scored, then only the winners are shown to the answering call.

**The key difference.** Its "inner speech" is a recorded prompt stage, not a continuous private stream, and nothing runs between messages.

**Citations (all verify):**
- Vygotsky 1934, Thought and Language (English edition 1986) (verify)
- Alderson-Day and Fernyhough 2015, "Inner speech: development, cognitive functions, phenomenology, and neurobiology", Psychological Bulletin 141:931 (verify)

## Sensitive periods (`sensitive-periods`)

**What humans show.** Some abilities, such as first-language acquisition and visual cortex tuning, are learned much more easily during limited windows of development.

**What Stebula shows.** Stebula has no developmental windows. Its model weights never change; only its memory file does.

**The key difference.** Timing effects in humans come from changing brain plasticity. Order effects in Stebula (what it read first) would come from prompt context, a different mechanism.

**Citations (all verify):**
- Newport 1990, "Maturational constraints on language learning", Cognitive Science 14:11 (verify)
- Hensch 2005, "Critical period plasticity in local cortical circuits", Nature Reviews Neuroscience 6:877 (verify)

## Social deprivation (`social-deprivation`)

**What humans show.** Severe early neglect harms cognition and attachment, and earlier placement in a family improves outcomes. Infant monkeys raised in isolation show lasting social deficits.

**What Stebula shows.** The isolation experiment compares an agent that only reads, one that only talks, one that does both, and one that gets nothing.

**The key difference.** Deprivation in children damages a developing body and brain over years. An agent with an empty memory file is not harmed; it is simply the base model.

**Citations (all verify):**
- Nelson et al. 2007, "Cognitive recovery in socially deprived young children: the Bucharest Early Intervention Project", Science 318:1937 (verify)
- Harlow 1958, "The nature of love", American Psychologist 13:673 (verify)

## Introspection accuracy (`introspection-accuracy`)

**What humans show.** People often explain their own choices with reasons that do not match what drove them, and can fail to notice changes in their own choices.

**What Stebula shows.** Self-prediction tests and the said-vs-shown check compare what the agent says about itself with what it does.

**The key difference.** Humans have a lifetime of unrecorded behavior. Stebula's behavior is fully recorded, so a mismatch can be checked directly, but its reports are text produced by a model, not a window into its processing.

**Citations (all verify):**
- Nisbett and Wilson 1977, "Telling more than we can know", Psychological Review 84:231 (verify)
- Johansson et al. 2005, "Failure to detect mismatches between intention and outcome in a simple decision task", Science 310:116 (verify)
- Schwitzgebel 2008, "The unreliability of naive introspection", Philosophical Review 117:245 (verify)

## Personality heritability (`personality-heritability`)

**What humans show.** Across twin studies, roughly half of the variation in personality traits is attributed to genetic differences.

**What Stebula shows.** The empty-memory baseline plays the role of the inherited part: traits that appear with no reading and no conversation come from the base model.

**The key difference.** Heritability is a statistic about differences within a population. One baseline sample from one model is not a heritability estimate.

**Citations (all verify):**
- Bouchard and McGue 2003, "Genetic and environmental influences on human psychological differences", Journal of Neurobiology 54:4 (verify)
- Polderman et al. 2015, "Meta-analysis of the heritability of human traits based on fifty years of twin studies", Nature Genetics 47:702 (verify)
