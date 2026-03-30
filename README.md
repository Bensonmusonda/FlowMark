# FlowMark
A minimalistic **viewing** and **editing** program for *markdown* files written in ***Electron***.
## Features
- **Live syntax highlight** - Real-time application of markdown effects on typing
- **Clean minimal UI**
- **File Operations** - New file (`Ctrl+N`), Open file (`Ctrl+O`), Save (`Ctrl+S`), Save file (`Ctrl+Shift+S`)
- **Menu** - Hamburger (☰) dropdown listing all file operations and distraction-free toggle with their keyboard shortcuts
- **Distraction-free Mode** - `F11` or via menu, hides the titlebar, editor expands to full window height

## Setup Intructions
> [!NOTE]:
> An executable has not been built yet so the setup will involve some manual tinkering.
- **Install *nodejs*** - Visit the [download page](https://nodejs.org/en/download) on the official *nodejs* website and follow the instructions for your respective platform to install it on your system.
- **Clone the repository** - Open a terminal and run the following commands:
    ```cmd
    git clone https://github.com/Bensonmusonda/FlowMark
    cd flowmark
    ```
- **Opening the program** - Run the following command:
    ```cmd
    npm install           # only on the first run
    npm start             # starts the program
    ```