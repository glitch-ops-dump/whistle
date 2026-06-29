# Whistle Private Demo Asset Lane

Whistle's public open-source repository should only contain neutral placeholder assets with clear redistribution rights.

For videos, stakeholder walkthroughs, or private mockups that need official-looking imagery, use one of these private lanes:

- Local only: create `private-assets/` at the repository root. This path is ignored by git.
- Shared team use: create a separate private repository such as `whistle-private-assets` and clone it outside this repository.

Recommended private asset structure:

```text
private-assets/
  tn-video-demo/
    brand/
    portraits/
    department-marks/
    readme-rights-notes.md
```

Private assets must not be committed to this repository unless redistribution rights are confirmed and documented. Generated video files that include those assets should also stay outside the public repository unless they are cleared for publication.

Before making this repository public, remember that deleting files from the current tree does not remove them from git history. If unapproved assets were committed earlier, use a fresh clean public repository or a deliberate history rewrite before public release.
