## udot

Install bin locally using curl
```bash
curl -o ~/local/bin/udot https://raw.github.com/maksimr/udot/master/index.mjs \
  && chmod +x ~/local/bin/udot
```

Run bin without installation
```bash
curl -s -L https://raw.github.com/maksimr/udot/master/index.mjs | \
  node --input-type=module - \
  --base-dir=/tmp/dotfiles \
  --home-dir=/tmp/root \
  use https://github.com/<username>/dotfiles
```
