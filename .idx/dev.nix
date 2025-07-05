{ pkgs, ... }: {
  # 1. Select a Nixpkgs channel.
  # "stable-24.05" is a good choice for stability.
  # "unstable" gives you the latest packages.
  channel = "unstable";

  # 2. Specify the packages needed for your environment.
  # Use https://search.nixos.org/packages to find more.
  packages = [
    pkgs.nodejs_20
    pkgs.firebase-tools
    pkgs.nodePackages.npm # For managing Node.js dependencies
  ];

  # 3. Configure environment variables.
  env = {
    # Example: Set a default environment variable.
    # MY_VARIABLE = "hello_world";
  };

  # 4. Define VS Code extensions to install.
  # Find extensions on https://open-vsx.org/
  idx.extensions = [
    "dbaeumer.vscode-eslint"
    "esbenp.prettier-vscode"
    "Firebase.firebase-vscode-extension"
  ];

  # 5. Set up web previews for your running services.
  idx.previews = {
    enable = true;
    previews = [
      {
        # Preview for the frontend React app
        id = "frontend";
        command = ["npm" "start"];
        cwd = "frontend";
        manager = "web";
      }
      # You can add another preview for the Firebase Emulator UI
      # {
      #   id = "emulator-ui";
      #   # The default port for the Emulator UI is 4000
      #   port = 4000;
      #   label = "Emulator UI";
      #   command = ["firebase","emulators:start"];
      # }
    ];
  };

  # 6. Define tasks that run when your workspace is created or started.
  idx.workspace = {
    # Runs when a workspace is first created.
    onCreate = {
      install-frontend-deps = "npm install --prefix frontend";
      install-functions-deps = "npm install --prefix functions";
      build-frontend = "npm run build --prefix frontend";
    };

    # Runs whenever the workspace is (re)started.
    onStart = {
      # Example: Start a background process.
      # start-backend = "npm run dev --prefix functions";
    };
  };
}
