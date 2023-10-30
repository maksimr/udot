# udot

![Test](https://github.com/maksimr/udot/workflows/Test/badge.svg)

Udot is a simple and opinionated dotfiles manager that allows users to manage their dotfiles in a single directory. It is designed to keep track of what's missing and what's different, and it can manage links and copies of files. Udot is unique in the way it manages links and copies, as it preserves the entire directory structure leading to a file and only considers the file itself as managed. This allows managed and unmanaged files to live next to each other without needing to specify complicated ignore rules.
Udot is hosted on GitHub and can be installed using curl on the user's operating system, or running even without local installation.

Overall, Udot is a simple and easy-to-use tool for managing dotfiles that offers unique features for preserving directory structures and managing links and copies of files.

How to install Udot on your system
```bash
curl -s -L https://raw.github.com/maksimr/udot/main/index.mjs \
  --output ~/.local/bin/udot \
  && chmod +x ~/.local/bin/udot
```

run Udot without installation
```bash
curl -s -L https://raw.github.com/maksimr/udot/main/index.mjs | \
  node --input-type=module - \
  --base-dir=/tmp/dotfiles \
  --home-dir=/tmp/root \
  use https://github.com/<username>/dotfiles
```
