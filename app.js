class ProjectStorage {
    constructor() {
        this.dbName = 'ProjectManagerDB';
        this.dbVersion = 1;
        this.db = null;
    }
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('projects')) {
                    const store = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('path', 'path', { unique: false });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }
    async saveProject(project) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readwrite');
            const store = transaction.objectStore('projects');
            const request = store.put(project);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    async getProjects() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readonly');
            const store = transaction.objectStore('projects');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }
    async deleteProject(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readwrite');
            const store = transaction.objectStore('projects');
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    async getSetting(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : null);
            request.onerror = () => reject(request.error);
        });
    }
    async saveSetting(key, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readwrite');
            const store = transaction.objectStore('settings');
            const request = store.put({ key, value });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}
class FileUtils {
    static async readFileAsText(fileHandle) {
        const file = await fileHandle.getFile();
        return await file.text();
    }
    static async readFileAsDataURL(fileHandle) {
        const file = await fileHandle.getFile();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
    static async getDirectoryTree(dirHandle, basePath = '') {
        const tree = [];
        try {
            for await (const [name, handle] of dirHandle.entries()) {
                const path = basePath ? `${basePath}/${name}` : name;
                if (handle.kind === 'directory') {
                    tree.push({
                        name,
                        path,
                        type: 'directory',
                        children: await this.getDirectoryTree(handle, path)
                    });
                } else {
                    tree.push({
                        name,
                        path,
                        type: 'file'
                    });
                }
            }
        } catch (error) {
        }
        return tree;
    }
    static detectLanguages(files) {
        const extensions = new Set();
        const languageMap = {
            'js': 'JavaScript',
            'ts': 'TypeScript',
            'py': 'Python',
            'java': 'Java',
            'cpp': 'C++',
            'c': 'C',
            'cs': 'C#',
            'php': 'PHP',
            'rb': 'Ruby',
            'go': 'Go',
            'rs': 'Rust',
            'swift': 'Swift',
            'kt': 'Kotlin',
            'html': 'HTML',
            'css': 'CSS',
            'scss': 'SCSS',
            'vue': 'Vue',
            'jsx': 'React',
            'tsx': 'React',
            'json': 'JSON',
            'xml': 'XML',
            'yaml': 'YAML',
            'yml': 'YAML',
            'md': 'Markdown',
            'sh': 'Shell',
            'sql': 'SQL'
        };
        const collectExtensions = (items) => {
            items.forEach(item => {
                if (item.type === 'file') {
                    const ext = item.name.split('.').pop()?.toLowerCase();
                    if (ext && languageMap[ext]) {
                        extensions.add(languageMap[ext]);
                    }
                } else if (item.children) {
                    collectExtensions(item.children);
                }
            });
        };
        collectExtensions(files);
        return Array.from(extensions);
    }
}
class ProjectManager {
    constructor() {
        this.storage = new ProjectStorage();
        this.projects = [];
        this.currentFilters = ['all'];
        this.selectedFolderHandle = null;
        this.selectedMainFileHandle = null;
        this.selectedReadmeHandle = null;
        this.currentProjectHandle = null;
        this.editingProjectId = null;
        this.mainFolderHandle = null;
        this.unaddedProjects = [];
        this.currentUnaddedProject = null;
        this.selectedFolderPath = null;
    }
    async init() {
        try {
            await this.storage.init();
            await this.loadSettings();
            await this.loadProjects();
            await this.checkUnaddedProjects();
            this.setupEventListeners();
            this.renderProjects();
            await this.updateEmptyState();
        } catch (error) {
            throw error;
        }
    }
    async loadSettings() {
        try {
            let theme = localStorage.getItem('theme');
            if (!theme) {
                theme = await this.storage.getSetting('theme') || 'system';
                localStorage.setItem('theme', theme);
            }
            const mainFolder = await this.storage.getSetting('mainFolder');
            if (document.getElementById('themeSelect')) {
                document.getElementById('themeSelect').value = theme;
            }
            this.applyTheme(theme);
            if (mainFolder && document.getElementById('mainFolderPath')) {
                document.getElementById('mainFolderPath').textContent = mainFolder;
            }
        } catch (error) {
            const theme = localStorage.getItem('theme') || 'system';
            this.applyTheme(theme);
        }
    }
    applyTheme(theme) {
        if (theme === 'system') {
            const updateSystemTheme = () => {
                const prefersDark = window.matchMedia('(предпочитает цветовую схему: темную)').matches;
                document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
            };
            updateSystemTheme();
            window.matchMedia('(предпочитает цветовую схему: темную)').addEventListener('change', updateSystemTheme);
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    }
    async loadProjects() {
        this.projects = await this.storage.getProjects();
        this.projects = this.projects.map(project => {
            if (project.photo && typeof project.photo !== 'string') {
                try {
                    project.photo = String(project.photo);
                } catch (e) {
                    project.photo = null;
                }
            }
            return project;
        });
        this.updateFilters();
    }
    updateFilters() {
        const allTags = new Set();
        this.projects.forEach(project => {
            project.filters?.forEach(tag => allTags.add(tag));
        });
        const filtersList = document.getElementById('filtersList');
        const existingFilters = Array.from(filtersList.querySelectorAll('.filter-chip'))
            .map(chip => chip.dataset.filter);
        allTags.forEach(tag => {
            if (!existingFilters.includes(tag)) {
                const chip = document.createElement('button');
                chip.className = 'filter-chip';
                chip.dataset.filter = tag;
                chip.textContent = tag;
                chip.addEventListener('click', () => this.toggleFilter(tag));
                filtersList.appendChild(chip);
            }
        });
    }
    toggleFilter(filter) {
        const chip = document.querySelector(`[data-filter="${filter}"]`);
        if (filter === 'all') {
            this.currentFilters = ['all'];
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        } else {
            this.currentFilters = this.currentFilters.filter(f => f !== 'all');
            document.querySelector('[data-filter="все"]').classList.remove('active');
            if (this.currentFilters.includes(filter)) {
                this.currentFilters = this.currentFilters.filter(f => f !== filter);
                chip.classList.remove('active');
            } else {
                this.currentFilters.push(filter);
                chip.classList.add('active');
            }
            if (this.currentFilters.length === 0) {
                this.currentFilters = ['all'];
                document.querySelector('[data-filter="все"]').classList.add('active');
            }
        }
        this.renderProjects();
    }
    setupEventListeners() {
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filterProjects(e.target.value);
        });
        document.getElementById('addProjectBtn').addEventListener('click', () => this.openAddModal());
        document.getElementById('settingsBtn').addEventListener('click', () => this.openSettingsModal());
        document.getElementById('closeAddModal').addEventListener('click', () => this.closeAddModal());
        document.getElementById('closeViewModal').addEventListener('click', () => this.closeViewModal());
        document.getElementById('closeSettingsModal').addEventListener('click', () => this.closeSettingsModal());
        document.getElementById('cancelAddBtn').addEventListener('click', () => this.closeAddModal());
        document.getElementById('cancelSettingsBtn').addEventListener('click', () => this.closeSettingsModal());
        document.getElementById('addProjectForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveProject();
        });
        document.getElementById('selectFolderBtn').addEventListener('click', async () => {
            await this.selectProjectFolder();
        });
        document.getElementById('selectMainFileBtn').addEventListener('click', async () => {
            await this.selectMainFile();
        });
        document.getElementById('selectReadmeBtn').addEventListener('click', async () => {
            await this.selectReadmeFile();
        });
        document.getElementById('projectPhoto').addEventListener('change', (e) => {
            this.previewPhoto(e.target.files[0]);
        });
        document.getElementById('addTagBtn').addEventListener('click', () => this.addNewTag());
        document.getElementById('newTagInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addNewTag();
            }
        });
        document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveSettings());
        document.getElementById('selectMainFolderBtn').addEventListener('click', async () => {
            await this.selectMainFolder();
        });
        document.getElementById('themeSelect').addEventListener('change', (e) => {
            this.applyTheme(e.target.value);
        });
        document.getElementById('toggleFilesBtn').addEventListener('click', () => {
            const panel = document.getElementById('filesPanel');
            panel.classList.toggle('active');
            document.getElementById('projectMenuPanel').classList.remove('active');
        });
        document.getElementById('toggleMenuBtn').addEventListener('click', () => {
            const panel = document.getElementById('projectMenuPanel');
            panel.classList.toggle('active');
            document.getElementById('filesPanel').classList.remove('active');
        });
        document.getElementById('closeFilesPanel')?.addEventListener('click', () => {
            document.getElementById('filesPanel').classList.remove('active');
        });
        document.getElementById('closeMenuPanel')?.addEventListener('click', () => {
            document.getElementById('projectMenuPanel').classList.remove('active');
        });
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });
        document.querySelector('[data-filter="все"]').addEventListener('click', () => {
            this.toggleFilter('all');
        });
    }
    async selectProjectFolder() {
        try {
            if ('showDirectoryPicker' in window) {
                const handle = await window.showDirectoryPicker();
                this.selectedFolderHandle = handle;
                document.getElementById('selectedFolderPath').textContent = handle.name;
                const nameInput = document.getElementById('projectName');
                if (nameInput) {
                    nameInput.value = handle.name;
                }
                await this.autoFindReadme(handle);
            } else {
                alert('File System Access API не поддерживается в вашем браузере. Используйте Chrome или Edge.');
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
            }
        }
    }
    async autoFindReadme(dirHandle) {
        try {
            for await (const [name, handle] of dirHandle.entries()) {
                if (name.toLowerCase() === 'readme.md' && handle.kind === 'file') {
                    this.selectedReadmeHandle = handle;
                    const content = await FileUtils.readFileAsText(handle);
                    document.getElementById('readmeTextarea').value = content;
                    document.getElementById('selectedReadmePath').textContent = name;
                    break;
                }
            }
        } catch (error) {
        }
    }
    async selectMainFile() {
        if (!this.selectedFolderHandle) {
            alert('Сначала выберите папку проекта');
            return;
        }
        try {
            if ('showOpenFilePicker' in window) {
                const [handle] = await window.showOpenFilePicker({
                    startIn: this.selectedFolderHandle
                });
                this.selectedMainFileHandle = handle;
                document.getElementById('selectedMainFilePath').textContent = handle.name;
            } else {
                alert('File System Access API не поддерживается в вашем браузере.');
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
            }
        }
    }
    async selectReadmeFile() {
        if (!this.selectedFolderHandle) {
            alert('Сначала выберите папку проекта');
            return;
        }
        try {
            if ('showOpenFilePicker' in window) {
                const [handle] = await window.showOpenFilePicker({
                    startIn: this.selectedFolderHandle,
                    types: [{
                        description: 'Файлы уценки',
                        accept: { 'text/markdown': ['.md'] }
                    }]
                });
                this.selectedReadmeHandle = handle;
                const content = await FileUtils.readFileAsText(handle);
                document.getElementById('readmeTextarea').value = content;
                document.getElementById('selectedReadmePath').textContent = handle.name;
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
            }
        }
    }
    previewPhoto(file) {
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const preview = document.getElementById('photoPreview');
                if (preview) {
                    preview.innerHTML = `<img src="${e.target.result}" alt="Preview" style="max-width: 100%; высота: авто;">`;
                }
            };
            reader.onerror = (error) => {
            };
            reader.readAsDataURL(file);
        } else {
            const preview = document.getElementById('photoPreview');
            if (preview) {
                preview.innerHTML = '';
            }
        }
    }
    addNewTag() {
        const input = document.getElementById('newTagInput');
        const tagName = input.value.trim();
        if (tagName) {
            this.addTagToForm(tagName);
            input.value = '';
        }
    }
    addTagToForm(tagName) {
        const selectedTags = document.getElementById('selectedTags');
        const existingTags = Array.from(selectedTags.querySelectorAll('.selected-tag'))
            .map(tag => tag.textContent.trim().replace('×', '').trim());
        if (existingTags.includes(tagName)) return;
        const tagElement = document.createElement('div');
        tagElement.className = 'selected-tag';
        tagElement.innerHTML = `
            ${tagName}
            <span class="remove-tag" data-tag="${tagName}">×</span>
        `;
        tagElement.querySelector('.remove-tag').addEventListener('click', () => {
            tagElement.remove();
        });
        selectedTags.appendChild(tagElement);
    }
    async saveProject() {
        if (!this.editingProjectId && !this.selectedFolderHandle) {
            alert('Выберите папку проекта');
            return;
        }
        const name = this.selectedFolderHandle ? this.selectedFolderHandle.name.trim() : (document.getElementById('projectName')?.value.trim() || '');
        if (!name) {
            alert('Не удалось определить название проекта');
            return;
        }
        const photoFile = document.getElementById('projectPhoto').files[0];
        let photoDataUrl = null;
        if (photoFile) {
            try {
                photoDataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        resolve(e.target.result);
                    };
                    reader.onerror = (error) => {
                        reject(error);
                    };
                    reader.readAsDataURL(photoFile);
                });
            } catch (error) {
                if (this.editingProjectId) {
                    const existingProject = this.projects.find(p => p.id === this.editingProjectId);
                    if (existingProject && existingProject.photo) {
                        photoDataUrl = existingProject.photo;
                    }
                }
            }
        } else {
            if (this.editingProjectId) {
                const existingProject = this.projects.find(p => p.id === this.editingProjectId);
                if (existingProject && existingProject.photo) {
                    photoDataUrl = existingProject.photo;
                }
            }
        }
        const readmeContent = document.getElementById('readmeTextarea').value;
        const selectedTags = Array.from(document.getElementById('selectedTags').querySelectorAll('.selected-tag'))
            .map(tag => tag.textContent.trim().replace('×', '').trim());
        const mainFilePath = this.selectedMainFileHandle ? this.selectedMainFileHandle.name : null;
        const readmePath = this.selectedReadmeHandle ? this.selectedReadmeHandle.name : null;
        let filesTree = [];
        let languages = [];
        if (this.selectedFolderHandle) {
            filesTree = await FileUtils.getDirectoryTree(this.selectedFolderHandle);
            languages = FileUtils.detectLanguages(filesTree);
        } else {
            const existingProject = this.projects.find(p => p.id === this.editingProjectId);
            if (existingProject) {
                filesTree = existingProject.filesTree || [];
                languages = existingProject.languages || [];
            }
        }
        let photoForSave = null;
        if (photoDataUrl) {
            if (typeof photoDataUrl === 'string') {
                photoForSave = photoDataUrl;
            } else if (photoDataUrl.toString && typeof photoDataUrl.toString === 'function') {
                photoForSave = String(photoDataUrl);
            } else {
                photoForSave = null;
            }
        }
        const project = {
            id: this.editingProjectId || Date.now(),
            name,
            path: this.selectedFolderHandle ? this.selectedFolderHandle.name : (this.projects.find(p => p.id === this.editingProjectId)?.path || ''),
            mainFile: mainFilePath,
            photo: photoForSave,
            readme: readmeContent,
            readmePath: readmePath,
            filters: selectedTags,
            languages: languages,
            dateAdded: this.editingProjectId ? (this.projects.find(p => p.id === this.editingProjectId)?.dateAdded || new Date().toISOString()) : new Date().toISOString(),
            filesTree: filesTree
        };
        const wasEditing = this.editingProjectId !== null;
        await this.storage.saveProject(project);
        await this.loadProjects();
        await this.checkUnaddedProjects();
        this.renderProjects();
        await this.updateEmptyState();

        const shouldOpenNext = this.currentUnaddedProject && this.unaddedProjects && this.unaddedProjects.length > 0;
        this.currentUnaddedProject = null;

        this.closeAddModal();
        this.resetAddForm();
        this.editingProjectId = null;
        if (wasEditing) {
            document.getElementById('viewProjectModal').classList.remove('active');
        }

        if (shouldOpenNext) {
            setTimeout(async () => {
                await this.addUnaddedProject(this.unaddedProjects[0]);
            }, 300);
        }
    }
    resetAddForm() {
        document.getElementById('addProjectForm').reset();
        document.getElementById('selectedFolderPath').textContent = '';
        document.getElementById('selectedMainFilePath').textContent = '';
        document.getElementById('selectedReadmePath').textContent = '';
        document.getElementById('photoPreview').innerHTML = '';
        document.getElementById('selectedTags').innerHTML = '';
        const nameInput = document.getElementById('projectName');
        if (nameInput) {
            nameInput.value = '';
        }
        this.selectedFolderHandle = null;
        this.selectedMainFileHandle = null;
        this.selectedReadmeHandle = null;
        this.editingProjectId = null;
        this.currentUnaddedProject = null;
    }
    openAddModal() {
        this.resetAddForm();
        document.getElementById('addProjectModal').classList.add('active');
        document.querySelector('#addProjectModal .modal-header h2').textContent = 'Добавить проект';
        this.loadExistingTags();
    }
    editProject(project) {
        this.editingProjectId = project.id;
        document.getElementById('viewProjectModal').classList.remove('active');
        document.getElementById('filesPanel').classList.remove('active');
        document.getElementById('projectMenuPanel').classList.remove('active');
        document.querySelector('#addProjectModal .modal-header h2').textContent = 'Редактировать проект';
        document.getElementById('selectedFolderPath').textContent = project.path || project.name;
        document.getElementById('projectName').value = project.name;
        if (project.photo) {
            const preview = document.getElementById('photoPreview');
            preview.innerHTML = `<img src="${project.photo}" alt="${project.name}">`;
        }
        if (project.readme) {
            document.getElementById('readmeTextarea').value = project.readme;
        }
        if (project.readmePath) {
            document.getElementById('selectedReadmePath').textContent = project.readmePath;
        }
        if (project.mainFile) {
            document.getElementById('selectedMainFilePath').textContent = project.mainFile;
        }
        const selectedTags = document.getElementById('selectedTags');
        selectedTags.innerHTML = '';
        if (project.filters && project.filters.length > 0) {
            project.filters.forEach(tag => {
                this.addTagToForm(tag);
            });
        }
        document.getElementById('addProjectModal').classList.add('active');
        this.loadExistingTags();
    }
    closeAddModal() {
        document.getElementById('addProjectModal').classList.remove('active');
    }
    openSettingsModal() {
        document.getElementById('settingsModal').classList.add('active');
    }
    closeSettingsModal() {
        document.getElementById('settingsModal').classList.remove('active');
    }
    async loadExistingTags() {
        const allTags = new Set();
        this.projects.forEach(project => {
            project.filters?.forEach(tag => allTags.add(tag));
        });
        const tagsList = document.getElementById('existingTags');
        tagsList.innerHTML = '';
        allTags.forEach(tag => {
            const tagElement = document.createElement('div');
            tagElement.className = 'tag-item';
            tagElement.textContent = tag;
            tagElement.addEventListener('click', () => {
                tagElement.classList.toggle('selected');
                this.addTagToForm(tag);
            });
            tagsList.appendChild(tagElement);
        });
    }
    renderProjects() {
        const grid = document.getElementById('projectsGrid');
        grid.innerHTML = '';
        const filtered = this.getFilteredProjects();
        if (this.unaddedProjects && this.unaddedProjects.length > 0) {
            const unaddedSection = document.createElement('div');
            unaddedSection.style.cssText = 'сетка-столбец: 1/-1; поле-дно: 2rem;';
            unaddedSection.innerHTML = `
                <h3 style="margin-bottom: 1rem; color: var(--text-color);">Недобавленные проекты (${this.unaddedProjects.length})</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem;">
                    ${this.unaddedProjects.map(project => `
                        <div class="project-card" style="непрозрачность: 0,8;">
                            <div class="предварительный просмотр проекта" style="дисплей: гибкий;">
                                <span class="project-name-fallback">${this.escapeHtml(project.name)}</span>
                            </div>
                            <div class="project-info">
                                <div class="project-name">${this.escapeHtml(project.name)}</div>
                                <button class="БТН БТН-первичный" style="ширина: 100%; маржа-верх: 1рем;" data-add-unadded="${project.name}">Добавить проект</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
            grid.appendChild(unaddedSection);
            setTimeout(() => {
                unaddedSection.querySelectorAll('[данные-добавлены-не добавлены]').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const projectName = e.target.getAttribute('data-add-unadded');
                        const project = this.unaddedProjects.find(p => p.name === projectName);
                        if (project) {
                            await this.addUnaddedProject(project);
                        }
                    });
                });
            }, 100);
        }
        filtered.forEach(project => {
            const card = document.createElement('div');
            card.className = 'project-card';
            let previewHtml = '';
            let photoValue = project.photo;
            if (photoValue && typeof photoValue !== 'string') {
                try {
                    photoValue = String(photoValue);
                } catch (e) {
                    photoValue = null;
                }
            }
            const hasPhoto = photoValue &&
                           typeof photoValue === 'string' &&
                           photoValue.trim() !== '' &&
                           (photoValue.startsWith('data:image') || photoValue.startsWith('blob:'));
            if (hasPhoto) {
                previewHtml = `<img src="${photoValue}" alt="${project.name}" class="project-preview" onerror="this.style.display='none'; const fallback = this.nextElementSibling; if(fallback) fallback.style.display='flex';">`;
            }
            previewHtml += `<div class="project-preview project-preview-fallback" style="${hasPhoto ? 'display: none;' : 'display: flex;'}">
                <span class="project-name-fallback">${this.escapeHtml(project.name)}</span>
            </div>`;
            card.innerHTML = `
                ${previewHtml}
                <div class="project-info">
                    <div class="project-name">${this.escapeHtml(project.name)}</div>
                    ${project.filters && project.filters.length > 0 ? `
                        <div class="project-tags">
                            ${project.filters.slice(0, 3).map(tag => `<span class="project-tag">${this.escapeHtml(tag)}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
            card.addEventListener('click', () => this.viewProject(project));
            grid.appendChild(card);
        });
    }
    getFilteredProjects() {
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        const activeFilters = this.currentFilters;
        return this.projects.filter(project => {
            if (searchTerm) {
                const matchesName = project.name.toLowerCase().includes(searchTerm);
                const matchesReadme = project.readme?.toLowerCase().includes(searchTerm);
                const matchesFilters = project.filters?.some(f => f.toLowerCase().includes(searchTerm));
                if (!matchesName && !matchesReadme && !matchesFilters) {
                    return false;
                }
            }
            if (activeFilters.includes('all')) {
                return true;
            }
            return project.filters?.some(f => activeFilters.includes(f));
        });
    }
    filterProjects(searchTerm) {
        this.renderProjects();
    }
    async viewProject(project) {
        document.getElementById('viewProjectTitle').textContent = project.name;
        const readmeContentDiv = document.querySelector('#viewProjectModal .readme-content');
        if (project.readme) {
            if (typeof marked !== 'undefined') {
                readmeContentDiv.innerHTML = marked.parse(project.readme);
            } else {
                readmeContentDiv.innerHTML = this.markdownToHtml(project.readme);
            }
        } else {
            readmeContentDiv.innerHTML = '<p>README не найден</p>';
        }
        const filesTree = document.getElementById('filesTree');
        filesTree.innerHTML = this.renderFilesTree(project.filesTree || []);
        const menuContent = document.getElementById('projectMenuContent');
        menuContent.innerHTML = `
            <div class="menu-section">
                <h3>Название</h3>
                <p>${this.escapeHtml(project.name)}</p>
            </div>
            ${project.photo ? `
                <div class="menu-section">
                    <h3>Превью</h3>
                    <img src="${project.photo}" alt="${project.name}">
                </div>
            ` : ''}
            ${project.filters && project.filters.length > 0 ? `
                <div class="menu-section">
                    <h3>Теги</h3>
                    <div class="project-tags">
                        ${project.filters.map(tag => `<span class="project-tag">${this.escapeHtml(tag)}</span>`).join('')}
                    </div>
                </div>
            ` : ''}
            ${project.languages && project.languages.length > 0 ? `
                <div class="menu-section">
                    <h3>Языки программирования</h3>
                    <div class="menu-languages">
                        ${project.languages.map(lang => `<span class="language-badge">${this.escapeHtml(lang)}</span>`).join('')}
                    </div>
                </div>
            ` : ''}
            <div class="menu-section">
                <h3>Дата добавления</h3>
                <p>${new Date(project.dateAdded).toLocaleDateString('ru-RU')}</p>
            </div>
            <div class="menu-section">
                <button id="editProjectBtn" class="btn btn-primary" style="width: 100%; margin-bottom: 0.5rem;">Редактировать проект</button>
                <button id="deleteProjectBtn" class="btn" style="width: 100%; background-color: var(--danger-color); color: white;">Удалить проект</button>
            </div>
        `;
        setTimeout(() => {
            const editBtn = document.getElementById('editProjectBtn');
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    this.editProject(project);
                });
            }
            const deleteBtn = document.getElementById('deleteProjectBtn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    this.deleteProject(project);
                });
            }
        }, 100);
        document.getElementById('viewProjectModal').classList.add('active');
    }
    closeViewModal() {
        document.getElementById('viewProjectModal').classList.remove('active');
        document.getElementById('filesPanel').classList.remove('active');
        document.getElementById('projectMenuPanel').classList.remove('active');
    }
    async deleteProject(project) {
        if (!confirm(`Вы уверены, что хотите удалить проект "${project.name}"?`)) {
            return;
        }
        try {
            await this.storage.deleteProject(project.id);
            await this.loadProjects();
            await this.checkUnaddedProjects();
            this.renderProjects();
            await this.updateEmptyState();
            this.closeViewModal();
        } catch (error) {
            alert('Ошибка при удалении проекта');
        }
    }
    async addUnaddedProject(unaddedProject) {
        this.selectedFolderHandle = unaddedProject.handle;
        this.selectedFolderPath = unaddedProject.name;
        document.getElementById('selectedFolderPath').textContent = unaddedProject.name;
        document.getElementById('projectName').value = unaddedProject.name;
        await this.autoFindReadme(unaddedProject.handle);
        document.getElementById('addProjectModal').classList.add('active');
        this.loadExistingTags();
        this.currentUnaddedProject = unaddedProject;
    }
    renderFilesTree(files, level = 0) {
        if (!files || files.length === 0) return '<p>Файлы не найдены</p>';
        let html = '';
        files.forEach(item => {
            const indent = '&nbsp;'.repeat(level * 2);
            if (item.type === 'directory') {
                html += `<div class="files-tree-item folder">${indent}📁 ${this.escapeHtml(item.name)}</div>`;
                if (item.children) {
                    html += this.renderFilesTree(item.children, level + 1);
                }
            } else {
                html += `<div class="files-tree-item">${indent}📄 ${this.escapeHtml(item.name)}</div>`;
            }
        });
        return html;
    }
    markdownToHtml(markdown) {
        if (!markdown) return '';
        let html = markdown;
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
        html = html.replace(/```(\w+)?\n([\s\S]*?)```/gim, '<pre><code>$2</code></pre>');
        html = html.replace(/`([^`]+)`/gim, '<code>$1</code>');
        html = html.replace(/\*\*(.+?)\*\*/gim, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/gim, '<em>$1</em>');
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>');
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/gim, '<img src="$2" alt="$1">');
        html = html.replace(/^\* (.+)$/gim, '<li>$1</li>');
        html = html.replace(/^\- (.+)$/gim, '<li>$1</li>');
        html = html.replace(/^\+ (.+)$/gim, '<li>$1</li>');
        html = html.split(/\n\n+/).map(p => {
            if (!p.trim()) return '';
            if (p.trim().startsWith('<')) return p;
            return '<p>' + p.trim() + '</p>';
        }).join('');
        html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
        html = html.replace(/\n/gim, '<br>');
        return html;
    }
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    async updateEmptyState() {
        const emptyState = document.getElementById('emptyState');
        const emptyStateTitle = document.getElementById('emptyStateTitle');
        const emptyStateText = document.getElementById('emptyStateText');
        const addFirstProjectBtn = document.getElementById('addFirstProjectBtn');
        const grid = document.getElementById('projectsGrid');
        if (this.projects.length === 0) {
            if (this.unaddedProjects && this.unaddedProjects.length > 0) {
                emptyStateTitle.textContent = `Нужно добавить ${this.unaddedProjects.length} проектов`;
                пустойСтатетекст. textContent = `В вашей папке найдено ${this.unaddedProjects.length} проектов, которые еще не добавлены. Добавьте их, чтобы начать работу.`;
                addFirstProjectBtn.textContent = `Добавить оставшиеся проекты (${this.unaddedProjects.length})`;
                addFirstProjectBtn.onclick = async () => {
                    if (this.unaddedProjects && this.unaddedProjects.length > 0) {
                        await this.addUnaddedProject(this.unaddedProjects[0]);
                    }
                };
            } else {
                const mainFolderName = await this.storage.getSetting('mainFolder');
                if (mainFolderName && !this.mainFolderHandle) {
                    emptyStateTitle.textContent = 'Выберите главную папку';
                    emptyStateText.textContent = `Для работы с недобавленными проектами необходимо выбрать главную папку "${mainFolderName}" в настройках.`;
                    addFirstProjectBtn.textContent = 'Открыть настройки';
                    addFirstProjectBtn.onclick = () => {
                        this.openSettingsModal();
                    };
                } else {
                    emptyStateTitle.textContent = 'Нет проектов';
                    emptyStateText.textContent = 'Добавьте свой первый проект, чтобы начать работу';
                    addFirstProjectBtn.textContent = 'Добавить первый проект';
                    addFirstProjectBtn.onclick = () => {
                        this.openAddModal();
                    };
                }
            }
            emptyState.classList.add('visible');
            grid.style.display = 'none';
        } else {
            emptyState.classList.remove('visible');
            grid.style.display = 'grid';
        }
    }
    async saveSettings() {
        try {
            const theme = document.getElementById('themeSelect').value;
            localStorage.setItem('theme', theme);
            await this.storage.saveSetting('theme', theme);
            this.applyTheme(theme);
            const mainFolder = document.getElementById('mainFolderPath').textContent;
            if (mainFolder) {
                await this.storage.saveSetting('mainFolder', mainFolder);
            }
            this.closeSettingsModal();
        } catch (error) {
            alert('Не удалось сохранить настройки. Попробуйте еще раз.');
        }
    }
    async selectMainFolder() {
        try {
            if ('showDirectoryPicker' in window) {
                const handle = await window.showDirectoryPicker();
                this.mainFolderHandle = handle;
                document.getElementById('mainFolderPath').textContent = handle.name;
                await this.storage.saveSetting('mainFolder', handle.name);
                await this.checkUnaddedProjects();
                this.renderProjects();
                await this.updateEmptyState();
            } else {
                alert('File System Access API не поддерживается в вашем браузере.');
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
            }
        }
    }
    async checkUnaddedProjects() {
        if (!this.mainFolderHandle) {
            const mainFolderName = await this.storage.getSetting('mainFolder');
            if (!mainFolderName) {
                this.unaddedProjects = [];
                return;
            }
            this.unaddedProjects = [];
            return;
        }
        try {
            const existingPaths = new Set(this.projects.map(p => (p.path || p.name).toLowerCase()));
            const unadded = [];
            for await (const [name, handle] of this.mainFolderHandle.entries()) {
                if (handle.kind === 'directory') {
                    const normalizedName = name.toLowerCase();
                    if (!existingPaths.has(normalizedName)) {
                        unadded.push({
                            name: name,
                            handle: handle,
                            path: name
                        });
                    }
                }
            }
            this.unaddedProjects = unadded;
            await this.updateEmptyState();
        } catch (error) {
            this.unaddedProjects = [];
            await this.updateEmptyState();
        }
    }
}
const app = new ProjectManager();
app.init().catch(error => {
    alert('Ошибка загрузки приложения.');
});