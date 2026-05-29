import {
	App,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	debounce,
} from "obsidian";

const DEFAULT_FRONTMATTER_KEY = "writing_goal";

interface JpWordCountHudSettings {
	defaultTargetCount: number;
	minimized: boolean;
	allowedFolders: string[]; // 前方一致の許可リスト。"*" で全許可
	frontmatterKey: string;   // 目標文字数のフロントマターキー
}

const DEFAULT_SETTINGS: JpWordCountHudSettings = {
	defaultTargetCount: 1000,
	minimized: false,
	allowedFolders: ["*"],
	frontmatterKey: DEFAULT_FRONTMATTER_KEY,
};

const HUD_CLASS = "writing-goal-hud";
const HUD_ROW_CLASS = "writing-goal-hud__row";
const HUD_TEXT_CLASS = "writing-goal-hud__text";
const HUD_BAR_CLASS = "writing-goal-hud__bar";
const HUD_BAR_FILL_CLASS = "writing-goal-hud__bar-fill";
const HUD_TOGGLE_CLASS = "writing-goal-hud__toggle";
const HUD_OVER_CLASS = "is-over";
const HUD_MINIMIZED_CLASS = "is-minimized";
const DEBOUNCE_MS = 150;
const ICON_EXPANDED = "▾";
const ICON_MINIMIZED = "▸";

export default class JpWordCountHudPlugin extends Plugin {
	settings: JpWordCountHudSettings = { ...DEFAULT_SETTINGS };

	private hudEl: HTMLDivElement | null = null;
	private textEl: HTMLDivElement | null = null;
	private barEl: HTMLDivElement | null = null;
	private barFillEl: HTMLDivElement | null = null;
	private toggleEl: HTMLButtonElement | null = null;

	private debouncedUpdate = debounce(
		() => this.updateHud(),
		DEBOUNCE_MS,
		true,
	);

	override async onload(): Promise<void> {
		await this.loadSettings();

		this.hudEl = document.createElement("div");
		this.hudEl.classList.add(HUD_CLASS);
		this.hudEl.style.display = "none";

		const rowEl = document.createElement("div");
		rowEl.classList.add(HUD_ROW_CLASS);

		this.textEl = document.createElement("div");
		this.textEl.classList.add(HUD_TEXT_CLASS);
		rowEl.appendChild(this.textEl);

		this.toggleEl = document.createElement("button");
		this.toggleEl.type = "button";
		this.toggleEl.classList.add(HUD_TOGGLE_CLASS);
		this.toggleEl.setAttribute("aria-label", "最小化/展開");
		this.toggleEl.addEventListener("click", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			this.settings.minimized = !this.settings.minimized;
			void this.saveSettings();
			this.updateHud();
		});
		rowEl.appendChild(this.toggleEl);

		this.hudEl.appendChild(rowEl);

		this.barEl = document.createElement("div");
		this.barEl.classList.add(HUD_BAR_CLASS);
		this.barFillEl = document.createElement("div");
		this.barFillEl.classList.add(HUD_BAR_FILL_CLASS);
		this.barEl.appendChild(this.barFillEl);
		this.hudEl.appendChild(this.barEl);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.updateHud();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				this.debouncedUpdate();
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				this.updateHud();
			}),
		);

		this.addSettingTab(new JpWordCountHudSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.updateHud();
		});
	}

	override onunload(): void {
		if (this.hudEl) {
			this.hudEl.remove();
			this.hudEl = null;
		}
		this.textEl = null;
		this.barEl = null;
		this.barFillEl = null;
		this.toggleEl = null;
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<JpWordCountHudSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private hideHud(): void {
		if (this.hudEl) {
			this.hudEl.style.display = "none";
			this.hudEl.remove();
		}
	}

	updateHud(): void {
		if (!this.hudEl || !this.textEl || !this.barFillEl || !this.toggleEl) {
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			this.hideHud();
			return;
		}

		if (!isFolderAllowed(view.file?.path ?? null, this.settings.allowedFolders)) {
			this.hideHud();
			return;
		}

		if (this.hudEl.parentElement !== view.contentEl) {
			view.contentEl.appendChild(this.hudEl);
		}

		const editor = view.editor;
		const selection = editor.getSelection();
		const hasSelection = selection.length > 0;
		const targetText = hasSelection ? selection : editor.getValue();

		const count = countJapaneseCharacters(targetText);
		const target = this.resolveTargetCount(view.file);
		const label = hasSelection ? "選択" : "全体";
		const ratio = target > 0 ? Math.min(count / target, 1) : 0;
		const isOver = target > 0 && count >= target;

		this.textEl.textContent = `${label} ${count} / ${target} 字`;
		this.barFillEl.style.width = `${ratio * 100}%`;
		this.hudEl.classList.toggle(HUD_OVER_CLASS, isOver);
		this.hudEl.classList.toggle(HUD_MINIMIZED_CLASS, this.settings.minimized);
		this.toggleEl.textContent = this.settings.minimized
			? ICON_MINIMIZED
			: ICON_EXPANDED;
		this.toggleEl.setAttribute(
			"aria-expanded",
			this.settings.minimized ? "false" : "true",
		);
		this.hudEl.style.display = "block";
	}

	private resolveTargetCount(file: TFile | null): number {
		if (file) {
			const cache = this.app.metadataCache.getFileCache(file);
			const key = this.settings.frontmatterKey || DEFAULT_FRONTMATTER_KEY;
			const raw = cache?.frontmatter?.[key];
			const parsed = parsePositiveInt(raw);
			if (parsed !== null) {
				return parsed;
			}
		}
		return this.settings.defaultTargetCount;
	}
}

class JpWordCountHudSettingTab extends PluginSettingTab {
	plugin: JpWordCountHudPlugin;

	constructor(app: App, plugin: JpWordCountHudPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("デフォルト目標文字数")
			.setDesc(
				`各ノートの frontmatter に目標文字数のキー: 2000 のように指定するとそちらが優先されます。`,
			)
			.addText((text) =>
				text
					.setPlaceholder("1000")
					.setValue(String(this.plugin.settings.defaultTargetCount))
					.onChange(async (value) => {
						const parsed = parsePositiveInt(value);
						if (parsed !== null) {
							this.plugin.settings.defaultTargetCount = parsed;
							await this.plugin.saveSettings();
							this.plugin.updateHud();
						}
					}),
			);

		new Setting(containerEl)
			.setName("目標文字数のフロントマターキー")
			.setDesc(
				`各ノートの frontmatter でこのキーに目標値を書くと優先されます。既定: ${DEFAULT_FRONTMATTER_KEY}`,
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_FRONTMATTER_KEY)
					.setValue(this.plugin.settings.frontmatterKey)
					.onChange(async (value) => {
						this.plugin.settings.frontmatterKey = value.trim();
						await this.plugin.saveSettings();
						this.plugin.updateHud();
					}),
			);

		new Setting(containerEl)
			.setName("表示するフォルダ")
			.setDesc(
				"1行に1フォルダ。* ですべてのフォルダ。特定フォルダだけにしたい場合は * を消してパスを記入。空にすると非表示。",
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("*")
					.setValue(this.plugin.settings.allowedFolders.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.allowedFolders = value
							.split("\n")
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
						await this.plugin.saveSettings();
						this.plugin.updateHud();
					}),
			);
	}
}

export function isFolderAllowed(
	filePath: string | null,
	folders: string[],
): boolean {
	for (const raw of folders) {
		const f = raw.trim().replace(/\/+$/, "");
		if (f === "*") return true;
		if (f === "") continue;
		if (filePath === null) continue;
		if (filePath === f || filePath.startsWith(f + "/")) return true;
	}
	return false;
}

function parsePositiveInt(raw: unknown): number | null {
	if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
		return Math.floor(raw);
	}
	if (typeof raw === "string") {
		const n = parseInt(raw, 10);
		if (!isNaN(n) && n > 0) {
			return n;
		}
	}
	return null;
}

export function countJapaneseCharacters(input: string): number {
	let text = input;

	text = stripCodeBlocks(text);
	text = stripMarkdownLinks(text);
	text = stripWikiLinks(text);
	text = stripAutolinks(text);
	text = stripBareUrls(text);
	text = stripMarkdownSymbols(text);
	text = stripWhitespace(text);

	return [...text].length;
}

function stripCodeBlocks(text: string): string {
	return text.replace(/```[\s\S]*?```/g, "");
}

function stripMarkdownLinks(text: string): string {
	let result = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
	result = result.replace(/\[[^\]]*\]\([^)]*\)/g, "");
	return result;
}

function stripWikiLinks(text: string): string {
	let result = text.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1");
	result = result.replace(/\[\[[^\]]*\]\]/g, "");
	return result;
}

function stripAutolinks(text: string): string {
	return text.replace(/<https?:\/\/[^>\s]+>/gi, "");
}

function stripBareUrls(text: string): string {
	return text.replace(/https?:\/\/[^\s、。「」『』（）()<>]+/gi, "");
}

function stripMarkdownSymbols(text: string): string {
	return text.replace(/[#*_>`~\-\[\]()|\\]/g, "");
}

function stripWhitespace(text: string): string {
	return text.replace(/\s+/g, "");
}
