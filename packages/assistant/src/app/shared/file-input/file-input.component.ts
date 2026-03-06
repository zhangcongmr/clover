import { Component, ElementRef, OnChanges, OnInit, SimpleChanges, afterNextRender, inject, output } from '@angular/core';
import { NotificationService } from '../notification/notification.service';


@Component({
    selector: 'file-input',
    templateUrl: './file-input.component.html',
    styleUrls: ['./file-input.component.css'],
    standalone: true
})
export class FileInputComponent implements OnInit, OnChanges {
    readonly fileContentChanged = output<Array<FileSystemFileHandle | FileSystemDirectoryHandle>>();
    readonly clearSelectd = output<void>();

    fileNameDisplay: string = 'No file selected';
    isFileSelected = false;
    elementRef = inject(ElementRef);
    private notificationService = inject(NotificationService);

    constructor() {
        let me = this;
        afterNextRender(() => {
            const dropZone = me.elementRef.nativeElement.children[0];

            // Drag and drop functionality
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, preventDefaults, false);
            });

            function preventDefaults(e: any) {
                e.preventDefault();
                e.stopPropagation();
            }

            ['dragenter', 'dragover'].forEach(eventName => {
                dropZone.addEventListener(eventName, highlight, false);
            });

            ['dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, unhighlight, false);
            });

            function highlight() {
                dropZone.classList.add('drag-over');
            }

            function unhighlight() {
                dropZone.classList.remove('drag-over');
            }

            dropZone.addEventListener('drop', handleDrop, false);

            async function handleDrop(e: any) {
                const handles: any = [];
                const items = e.dataTransfer.items
                let itemsArray = Array.from(items);
                let PromiseArray: any = [];
                for (let index = 0; index < itemsArray.length; index++) {
                    const element: any = itemsArray[index];
                    const handlePromise = element.getAsFileSystemHandle();
                    PromiseArray.push(handlePromise);
                }
                const handleResults = await Promise.all(PromiseArray);
                handles.push(...handleResults);

                me.fileNameDisplay = handles.map((hd: any) => hd.name).join(" ");
                me.isFileSelected = true;
                me.fileContentChanged.emit(handles);
            }

        });
    }

    ngOnInit(): void {

    }

    ngOnChanges(changes: SimpleChanges): void {

    }

    async openFileInContent() {
        if (!('showOpenFilePicker' in window)) {
            this.notificationService.showNotification('The File System Access API is not supported in this browser.', 'error');
            return;
        }
        // Try native file picker first
        try {
            if ('showOpenFilePicker' in window) {
                const handles: any = await (window as any).showOpenFilePicker({ multiple: true });
                if (!handles || handles.length === 0) return;
                this.fileNameDisplay = handles.map((hd: any) => hd.name).join(" ");
                this.isFileSelected = true;
                this.fileContentChanged.emit(handles);
                return;
            }
        } catch (err) {
            console.warn('showOpenFilePicker failed or unsupported', err);
        }
    }

    async openFolder(mode: 'read' | 'readwrite' = 'readwrite') {
        if (!('showDirectoryPicker' in window)) {
            this.notificationService.showNotification('The File System Access API is not supported in this browser.', 'error');
            return;
        }
        try {
            const handle: any = await (window as any).showDirectoryPicker({ mode });
            if (!handle) return;
            this.fileNameDisplay = handle.name;
            this.isFileSelected = true;
            this.fileContentChanged.emit([handle]);
            return;

        } catch (err) {
            console.error('openFolder error', err);
        }
    }

    onFileSelected(evt: any) {
        const file: File = evt.target.files[0];
        this.handleFileSelection(file);
    }


    private handleFileSelection(file: File) {
        if (file) {
            this.fileNameDisplay = `Selected: ${file.name}`;
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result;
                // this.fileContentChanged.emit({fileName: file.name, content: content});
            };
            reader.readAsText(file);
            this.isFileSelected = true;
        }
    }

    clearFileSelect() {
        this.isFileSelected = false;
        // Reset file info display
        this.fileNameDisplay = 'No file selected';
        this.clearSelectd.emit();
    }
}