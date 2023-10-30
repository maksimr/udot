## udot

Install bin locally using curl
```bash
curl -s -L https://raw.github.com/maksimr/udot/master/index.mjs \
  --output ~/.local/bin/udot \
  && chmod +x ~/.local/bin/udot
```

Run bin without installation
```bash
curl -s -L https://raw.github.com/maksimr/udot/master/index.mjs | \
  node --input-type=module - \
  --base-dir=/tmp/dotfiles \
  --home-dir=/tmp/root \
  use https://github.com/<username>/dotfiles
```
