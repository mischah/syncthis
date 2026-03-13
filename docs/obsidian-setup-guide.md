# Obsidian Sync Setup Guide

This guide walks you through setting up **syncthis** to keep your [Obsidian](https://obsidian.md) vault in sync across multiple devices — from scratch, no prior experience needed.

**What you'll end up with:** Your Obsidian notes automatically syncing to a private GitHub repository every 5 minutes, across all your devices.

**Time required:** About 15–20 minutes for the first device. 5 minutes for each additional device.

---

## Table of Contents

1. [Open a Terminal](#1-open-a-terminal)
2. [Install Git](#2-install-git)
3. [Install Node.js](#3-install-nodejs)
4. [Create a GitHub Account](#4-create-a-github-account)
5. [Create a Private Repository](#5-create-a-private-repository)
6. [Set Up SSH Access to GitHub](#6-set-up-ssh-access-to-github)
7. [Install syncthis](#7-install-syncthis)
8. [Initialize Your Vault](#8-initialize-your-vault)
9. [Start Syncing](#9-start-syncing)
10. [Set Up Your Second Device](#10-set-up-your-second-device)
11. [Useful Commands](#11-useful-commands)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Open a Terminal

A terminal is a text-based interface where you type commands. You only need it for the initial setup — after that, syncthis runs silently in the background.

**macOS:**
- Press **Cmd + Space** to open Spotlight, type **Terminal**, and press Enter.
- Alternatively, open **Finder → Applications → Utilities → Terminal**.

**Linux:**
- Press **Ctrl + Alt + T** (works on most distributions).
- Or search for "Terminal" in your application menu.

You should see a window with a blinking cursor, waiting for you to type. This is where you'll run all the commands below.

> **Tip:** You can copy commands from this guide and paste them into the terminal. On macOS, use **Cmd + V** to paste. On Linux, use **Ctrl + Shift + V**.

---

## 2. Install Git

Git is the version control system that syncthis uses under the hood to track and sync your files.

**Check if Git is already installed:**

```bash
git --version
```

If you see a version number (e.g. `git version 2.39.0`), you're good — skip to the next step.

**If Git is not installed:**

- **macOS:** The command above will prompt you to install the Xcode Command Line Tools. Click **Install** and wait for it to finish.
- **Linux (Debian/Ubuntu):** Run `sudo apt install git`
- **Linux (Fedora):** Run `sudo dnf install git`
- **Other systems:** Download from [git-scm.com/downloads](https://git-scm.com/downloads)

After installing, run `git --version` again to confirm.

---

## 3. Install Node.js

syncthis is built with Node.js. You need version 20 or newer.

**Check if Node.js is already installed:**

```bash
node --version
```

If you see `v20.x.x` or higher, you're good — skip to the next step.

**If Node.js is not installed (or the version is too old):**

1. Go to [nodejs.org](https://nodejs.org)
2. Download the **LTS** (Long Term Support) version — it's the big green button.
3. Run the installer and follow the prompts (the defaults are fine).
4. **Close and reopen your terminal** for the changes to take effect.
5. Run `node --version` again to confirm.

---

## 4. Create a GitHub Account

GitHub is where your vault will be stored (encrypted in transit and private by default). If you already have a GitHub account, skip to the next step.

1. Go to [github.com/signup](https://github.com/signup)
2. Follow the steps to create a free account.
3. Verify your email address.

That's it — a free account is all you need.

---

## 5. Create a Private Repository

A repository (or "repo") is a storage space on GitHub for your vault. We'll create a **private** one so only you can see your notes.

1. Go to [github.com/new](https://github.com/new) (or click the **+** button in the top-right corner of GitHub and select **New repository**).
2. Fill in the form:
   - **Repository name:** Choose something descriptive, e.g. `my-vault` or `obsidian-notes`.
   - **Description:** Optional. E.g. "My Obsidian vault".
   - **Visibility:** Select **Private**. This is important — it keeps your notes visible only to you.
   - **Initialize this repository:** Leave all checkboxes **unchecked** (no README, no .gitignore, no license).
3. Click **Create repository**.

You'll see a page with setup instructions. The important part is the SSH URL — it looks like:

```
git@github.com:yourname/my-vault.git
```

Copy this URL. You'll need it in step 8.

> **Detailed guide:** [Creating a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository) on GitHub Docs.

---

## 6. Set Up SSH Access to GitHub

SSH lets your computer communicate securely with GitHub without entering your password every time. This is a one-time setup per device.

### 6a. Check for an existing SSH key

```bash
ls ~/.ssh/id_ed25519.pub
```

If you see a file path (no error), you already have an SSH key — skip to **6c**.

### 6b. Generate a new SSH key

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
```

Replace `your-email@example.com` with the email you used for GitHub.

- When asked where to save the file, press **Enter** to accept the default.
- When asked for a passphrase, you can press **Enter** twice to skip it (or set one for extra security).

### 6c. Copy your public key

**macOS:**

```bash
cat ~/.ssh/id_ed25519.pub | pbcopy
```

This copies the key to your clipboard.

**Linux:**

```bash
cat ~/.ssh/id_ed25519.pub
```

Select and copy the entire output (starts with `ssh-ed25519` and ends with your email).

### 6d. Add the key to GitHub

1. Go to [github.com/settings/keys](https://github.com/settings/keys)
2. Click **New SSH key**.
3. **Title:** Something to identify this device, e.g. "MacBook Pro" or "Work Laptop".
4. **Key:** Paste the key you copied.
5. Click **Add SSH key**.

### 6e. Test the connection

```bash
ssh -T git@github.com
```

You should see: `Hi yourname! You've successfully authenticated...`

If you see a question about the authenticity of the host, type `yes` and press Enter.

> **Detailed guide:** [Connecting to GitHub with SSH](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) on GitHub Docs.

---

## 7. Install syncthis

Now install syncthis globally so you can use it from anywhere:

```bash
npm install -g syncthis
```

Verify the installation:

```bash
syncthis --version
```

You should see a version number.

> **Permission error on Linux?** If you get an `EACCES` error, see [Resolving npm permission errors](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally).

---

## 8. Initialize Your Vault

Navigate to your Obsidian vault folder. This is the folder that contains your `.obsidian` directory and all your notes.

```bash
cd /path/to/your/obsidian-vault
```

**Not sure where your vault is?**
- Open Obsidian → Settings (gear icon) → look at the vault path at the bottom of the left sidebar.
- On macOS, vaults are often in `~/Documents/` or `~/`.
- Example: `cd ~/Documents/MyVault`

Now link your vault to your GitHub repository:

```bash
syncthis init --remote git@github.com:yourname/my-vault.git
```

Replace `yourname/my-vault.git` with the SSH URL from step 5.

This will:
- Initialize Git in your vault folder (if not already done).
- Connect it to your GitHub repository.
- Create a `.gitignore` with Obsidian-specific defaults.
- Make an initial commit of all your files.
- Create a `.syncthis.json` configuration file.

---

## 9. Start Syncing

```bash
syncthis start
```

That's it! syncthis is now running as a background service. It will:
- Sync your vault every 5 minutes (default).
- Start automatically when you log in (if your OS supports it).
- Keep running even after you close the terminal.

You can safely close the terminal now.

---

## 10. Set Up Your Second Device

On your other device(s), repeat steps 1–7 (install Git, Node.js, set up SSH, install syncthis). Then, instead of `init --remote`, use `--clone` to download your vault:

```bash
syncthis init --clone git@github.com:yourname/my-vault.git --path ~/Documents/MyVault
syncthis start
```

This clones your vault from GitHub and starts syncing. Open the folder in Obsidian, and you're done.

---

## 11. Useful Commands

| Command | What it does |
|---------|--------------|
| `syncthis status` | Shows whether syncing is active, last sync time, and any issues. |
| `syncthis stop` | Stops the background sync (your files stay as they are). |
| `syncthis start` | Starts syncing again. |
| `syncthis logs` | Shows recent sync activity. |
| `syncthis logs --follow` | Shows live sync output (press Ctrl+C to stop watching). |

---

## 12. Troubleshooting

### "command not found: syncthis"

Node.js or npm is not in your system PATH. Try closing and reopening your terminal. If that doesn't help, reinstall Node.js from [nodejs.org](https://nodejs.org).

### "Permission denied (publickey)"

Your SSH key is not set up correctly. Go back to [step 6](#6-set-up-ssh-access-to-github) and make sure you've added your key to GitHub.

### "fatal: not a git repository"

You're not in the right directory. Make sure you `cd` into your Obsidian vault folder before running syncthis commands.

### "EACCES: permission denied" when installing

On Linux, npm may not have permission to install globally. See [npm's guide on fixing permissions](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally).

### Sync conflicts

If the same file was changed on two devices at the same time, syncthis creates a conflict copy (e.g. `note.conflict-2025-03-04T14-30-00.md`). Both versions are kept so you don't lose data. Open both files, merge the changes manually, and delete the conflict copy.

### Need more help?

- Check the [full documentation](https://github.com/mischah/syncthis#readme)
- [Open an issue](https://github.com/mischah/syncthis/issues) on GitHub
