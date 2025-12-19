# TRMNL Plugin Development Documentation

This document summarizes the key information for developing `trmnl` plugins, extracted from the official `trmnlp` GitHub repository's `README.md`.

### 1. Project Structure
A `trmnl` plugin project typically has the following structure:
```
.
├── .trmnlp.yml         # Local development server configuration
├── bin
│   └── dev             # Script to run the local server
└── src
    ├── full.liquid
    ├── half_horizontal.liquid
    ├── half_vertical.liquid
    ├── quadrant.liquid
    ├── shared.liquid
    └── settings.yml    # Plugin configuration (part of the plugin definition)
```

### 2. Creating a New Plugin
You can start building a plugin locally using the `trmnlp` CLI tool:

1.  **Generate a new plugin project:**
    ```sh
    trmnlp init [my_plugin]
    ```
2.  **Navigate into your plugin directory:**
    ```sh
    cd [my_plugin]
    ```
3.  **Develop locally:**
    ```sh
    trmnlp serve
    ```
    This will start a local web server that watches for changes to your Liquid templates and updates the preview automatically.
4.  **Authenticate (if you haven't already):**
    ```sh
    trmnlp login
    ```
    This saves your API key to `~/.config/trmnlp/config.yml`. You can also use the `$TRMNL_API_KEY` environment variable.
5.  **Push to the TRMNL server:**
    ```sh
    trmnlp push
    ```
    This uploads your plugin for display on your device.

### 3. Modifying an Existing Plugin
If you've built a plugin using the web-based editor, you can clone it, work locally, and push changes back:

1.  **Authenticate:**
    ```sh
    trmnlp login
    ```
2.  **Clone your plugin:**
    ```sh
    trmnlp clone [my_plugin] [id]
    ```
3.  **Navigate into your plugin directory:**
    ```sh
    cd [my_plugin]
    ```
4.  **Develop locally:**
    ```sh
    trmnlp serve
    ```
5.  **Push changes:**
    ```sh
    trmnlp push
    ```

### 4. Configuration Files

*   **`.trmnlp.yml` (Project Config):**
    This file lives in the root of your plugin project and configures the local development server. All fields are optional.
    ```yaml
    ---
    # auto-reload when files change (`watch: false` to disable)
    watch:
      - src
      - .trmnlp.yml

    # values of custom fields (defined in src/settings.yml)
    custom_fields:
      station: "{{ env.ICAO }}" # interpolate $IACO environment variable

    # Time zone IANA identifier to inject into trmnl.user
    time_zone: America/New_York

    # override variables
    variables:
      trmnl:
        user:
          name: Peter Quill
        plugin_settings:
          instance_name: Kevin Bacon Facts
    ```
    System environment variables are available in the `{{ env }}` Liquid variable within this file, allowing you to safely supply plugin secrets.

*   **`src/settings.yml` (Plugin Config):**
    This file is part of the plugin definition itself. Refer to the TRMNL documentation for details on its contents.

### 5. Running `trmnlp`
The `bin/trmnlp` script is provided for convenience. It uses the local Ruby gem if available, or falls back to the `trmnl/trmnlp` Docker image. You can modify this script to set up environment variables (like plugin secrets) before running the server.

*   **Installing via RubyGems:**
    Prerequisites: Ruby 3.x, Firefox (optional, for PNG rendering), ImageMagick (optional, for PNG rendering).
    ```sh
    gem install trmnl_preview
    trmnlp serve
    ```
*   **Installing via Docker:**
    ```sh
    docker run \
        --publish 4567:4567 \
        --volume "$(pwd):/plugin" \
        trmnl/trmnlp serve
    ```