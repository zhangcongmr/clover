import { Component, ElementRef, Input, OnChanges, OnInit, SimpleChanges, afterNextRender, inject, input, output } from '@angular/core';


@Component({
    selector: 'file-input',
    templateUrl: './file-input.component.html',
    styleUrls: ['./file-input.component.css'],
    standalone: true
})
export class FileInputComponent implements OnInit, OnChanges {
    readonly fileContentChanged = output<string | ArrayBuffer | null | undefined>();
    readonly clearSelectd = output<void>();

    fileNameDisplay: string = 'No file selected';
    isFileSelected = false;
    elementRef = inject(ElementRef);

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

            function handleDrop(e: any) {
                const dt = e.dataTransfer;
                const files = dt.files;
                me.handleFileSelection(files[0]);
            }

        });
    }

    ngOnInit(): void {

    }

    ngOnChanges(changes: SimpleChanges): void {

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
                this.fileContentChanged.emit(content);
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

        // 查询父元素下所有具有 'file-input-select' 的子元素
        const childElements = this.elementRef.nativeElement.getElementsByClassName('file-input-select');

        const fileInput = childElements[0];

        // Reset file input
        fileInput.value = '';
    }
}