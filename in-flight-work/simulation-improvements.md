# Misc

* make fuzzy duplicates checkbox default to checked
* make stripe and hubspot default to selected, but not shopify
* in the 'clean' section, add a 'clean all' button that cleans all three platforms

# Simulation

I'd like to see the generated data in a table. Specifically, I want to see how each record looks that's going into each platform, as well as the canonical record. The purpose of this is so that after a simulation run is generated, I want to quickly scan the generated data and spot examples that I can do spot checks on. This is for my own testing purposes, and live demo purposes.

The table should bubble up the dirtiest data to the top - the data that will require tier 2 resolution.

After a resolved data lake file is updated, I'd like the output grading table to include the canonical email address so that I can quickly find those resolved records back in the test target (fratelli software / organic intelligence).