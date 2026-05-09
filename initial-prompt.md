I want to build a command line utility that will import and export memory data (and other settings) for Claude Code so you can transfer them between machines.  Call the utility ClaudeMemoryMover (cmemmov)

Im thinking this should be written in node since we know the user has that installed since they are running claude code.

The tool should catalog the data and allow the user to select broad categories of data to export through an interactive menu.  Should have the option to include or exclude project level setting/memories/rules.  It then should export the data into a single file (JSON?)   There should also be a "silent" mode where you can export using command line switches.

To import it would be similar, the user can select which broad categories they want to import, or maybe even individual memory files (and then the indexes would be updated).  Shoould allow the user to specify which projects/rules/memories they import.  Again there should be command line switches to do this as a "silent" mode instead of interactive.   The import should have an option to merge the memories with those already there or overwrite the memories.

When importing, the tool should automatically resolve that projects might be in different paths.  There should also be a tool to fix paths for projects that are clones after the fact.

Needs to support windows/MacOs/linux and know the appropriate place to install the files.

So the typical workflow would be:
1. User Installs cmemmov (ClaudeMemoryMover) on old machine 
2. User exports their memories/rules/etc. off old machine, working through a multiselect menu to determine what they export.
3. User installs claude code on new machine (perhaps on different OS)
4. User clones their repos to new machine (perhaps in differnt folders)
5. User installs cmemmov on new machine
6. User transfer the export file to the new machine
7. User import their memories/rules/etc. and works through the interactive menu to select which ones to import

