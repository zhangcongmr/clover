/**
 * SVG Sprite 统一在ts文件中定义，方便读取
 */
export const SVG_SPRITE_CONTENT = `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="display: none;">
<defs>

        <clipPath id="icon-community-manage-btn-clip0_464_566">
        <rect width="24" height="23.9564" fill="currentColor" transform="translate(0.843262 0.31369)"></rect>
        </clipPath>
        
</defs>
   <symbol id="icon-add-file" viewBox="0 0 20 20">
        <path d="M4.4 2V4.4H2V6H4.4V8.4H6V6H8.4V4.4H6V2H4.4ZM3.6 17.2053V10H5.2V16.4H11.6V12.4C11.6 11.96 11.96 11.6 12.4 11.6L16.4 11.5992V5.2H10V3.6H17.2053C17.6442 3.6 18 3.96461 18 4.40198V13.2L13.2 17.9968L4.40177 18C3.95896 18 3.6 17.6441 3.6 17.2053ZM15.7368 13.1992L13.2 13.2V15.7352L15.7368 13.1992Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-add-folder" viewBox="0 0 20 20">
        <path d="M9.33136 3.77778H16.2C16.6418 3.77778 17 4.17575 17 4.66667V17.1111C17 17.602 16.6418 18 16.2 18H1.8C1.35818 18 1 17.602 1 17.1111V2.88889C1 2.39797 1.35818 2 1.8 2H7.73136L9.33136 3.77778ZM2.6 3.77778V16.2222H15.4V5.55556H8.66864L7.06863 3.77778H2.6ZM8.2 10V7.33333H9.8V10H12.2V11.7778H9.8V14.4444H8.2V11.7778H5.8V10H8.2Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-back" viewBox="0 0 24 24">
        <path d="M12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2ZM12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20ZM12 11H16V13H12V16L8 12L12 8V11Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-check-box" viewBox="0 0 45 46">
        <path d="M15.8333 15.5H29.1667C29.6269 15.5 30 15.8731 30 16.3333V29.6667C30 30.1269 29.6269 30.5 29.1667 30.5H15.8333C15.3731 30.5 15 30.1269 15 29.6667V16.3333C15 15.8731 15.3731 15.5 15.8333 15.5ZM16.6667 17.1667V28.8333H28.3333V17.1667H16.6667Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-close-icon" viewBox="0 0 18 18">
        <path d="M8.99999 8.11114L12.1111 5L13 5.88889L9.88887 9.00003L13 12.1111L12.1111 13L8.99999 9.88891L5.88889 13L5 12.1111L8.11111 9.00003L5 5.88889L5.88889 5L8.99999 8.11114Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-collapse" viewBox="0 0 19 21">
        <path d="M10.1179 6.75H16.3679C16.5337 6.75 16.6927 6.68415 16.8099 6.56694C16.9271 6.44973 16.9929 6.29076 16.9929 6.125C16.9929 5.95924 16.9271 5.80027 16.8099 5.68306C16.6927 5.56585 16.5337 5.5 16.3679 5.5H10.1179C9.95218 5.5 9.79321 5.56585 9.676 5.68306C9.55879 5.80027 9.49295 5.95924 9.49295 6.125C9.49295 6.29076 9.55879 6.44973 9.676 6.56694C9.79321 6.68415 9.95218 6.75 10.1179 6.75ZM16.3679 8H10.1179C9.95218 8 9.79321 8.06585 9.676 8.18306C9.55879 8.30027 9.49295 8.45924 9.49295 8.625C9.49295 8.79076 9.55879 8.94973 9.676 9.06694C9.79321 9.18415 9.95218 9.25 10.1179 9.25H16.3679C16.5337 9.25 16.6927 9.18415 16.8099 9.06694C16.9271 8.94973 16.9929 8.79076 16.9929 8.625C16.9929 8.45924 16.9271 8.30027 16.8099 8.18306C16.6927 8.06585 16.5337 8 16.3679 8ZM16.3679 11.75H10.1179C9.95218 11.75 9.79321 11.8158 9.676 11.9331C9.55879 12.0503 9.49295 12.2092 9.49295 12.375C9.49295 12.5408 9.55879 12.6997 9.676 12.8169C9.79321 12.9342 9.95218 13 10.1179 13H16.3679C16.5337 13 16.6927 12.9342 16.8099 12.8169C16.9271 12.6997 16.9929 12.5408 16.9929 12.375C16.9929 12.2092 16.9271 12.0503 16.8099 11.9331C16.6927 11.8158 16.5337 11.75 16.3679 11.75ZM16.3679 14.25H10.1179C9.95218 14.25 9.79321 14.3158 9.676 14.4331C9.55879 14.5503 9.49295 14.7092 9.49295 14.875C9.49295 15.0408 9.55879 15.1997 9.676 15.3169C9.79321 15.4342 9.95218 15.5 10.1179 15.5H16.3679C16.5337 15.5 16.6927 15.4342 16.8099 15.3169C16.9271 15.1997 16.9929 15.0408 16.9929 14.875C16.9929 14.7092 16.9271 14.5503 16.8099 14.4331C16.6927 14.3158 16.5337 14.25 16.3679 14.25ZM7.17545 5.6875L5.74294 7.12125V3.625C5.74294 3.45924 5.6771 3.30027 5.55989 3.18306C5.44268 3.06585 5.28371 3 5.11794 3C4.95218 3 4.79321 3.06585 4.676 3.18306C4.55879 3.30027 4.49295 3.45924 4.49295 3.625V7.11625L3.06045 5.6825C2.94257 5.56865 2.78469 5.50565 2.62082 5.50708C2.45695 5.5085 2.30019 5.57423 2.18431 5.69011C2.06843 5.80599 2.0027 5.96275 2.00127 6.12662C1.99985 6.2905 2.06285 6.44837 2.1767 6.56625L4.67669 9.06625C4.73471 9.12491 4.80377 9.17151 4.87989 9.20334C4.95601 9.23518 5.03768 9.25163 5.12018 9.25175C5.20269 9.25187 5.28441 9.23564 5.36061 9.20402C5.43682 9.1724 5.50601 9.126 5.56419 9.0675L8.0592 6.5725C8.11731 6.51447 8.16342 6.44557 8.1949 6.36972C8.22638 6.29387 8.24261 6.21256 8.24267 6.13044C8.24273 6.04832 8.22661 5.96699 8.19524 5.8911C8.16386 5.81521 8.11785 5.74623 8.05982 5.68812C8.00179 5.63001 7.93289 5.5839 7.85704 5.55242C7.78119 5.52094 7.69988 5.50471 7.61776 5.50465C7.53564 5.50459 7.45431 5.52071 7.37842 5.55208C7.30253 5.58346 7.23356 5.62947 7.17545 5.6875ZM5.56419 11.9325C5.4463 11.8147 5.28647 11.7486 5.11982 11.7486C4.95317 11.7486 4.79334 11.8147 4.67544 11.9325L2.17544 14.4325C2.0616 14.5504 1.9986 14.7083 2.00002 14.8721C2.00145 15.036 2.06718 15.1928 2.18306 15.3086C2.29894 15.4245 2.4557 15.4902 2.61957 15.4917C2.78344 15.4931 2.94132 15.4301 3.05919 15.3162L4.49295 13.8837V17.375C4.49295 17.5408 4.55879 17.6997 4.676 17.8169C4.79321 17.9342 4.95218 18 5.11794 18C5.28371 18 5.44268 17.9342 5.55989 17.8169C5.6771 17.6997 5.74294 17.5408 5.74294 17.375V13.8788L7.17545 15.3112C7.29332 15.4251 7.4512 15.4881 7.61507 15.4867C7.77894 15.4852 7.9357 15.4195 8.05158 15.3036C8.16746 15.1878 8.23319 15.031 8.23462 14.8671C8.23604 14.7033 8.17304 14.5454 8.0592 14.4275L5.56419 11.9325Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-down" viewBox="0 0 24 25">
        <path d="M12.3639 13.3638L17.3137 8.41403L18.7279 9.82824L12.3639 16.1923L6 9.82824L7.41421 8.41403L12.3639 13.3638Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-expand" viewBox="0 0 20 20">
        <path d="M15 7.57985L10.0001 2.5L5.00012 7.57985L6.13929 8.73722L10.0001 4.81477L13.8608 8.73722L15 7.57985ZM5 12.4202L9.99998 17.5L14.9999 12.4202L13.8607 11.2628L9.99998 15.1853L6.13917 11.2628L5 12.4202Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-folder" viewBox="0 0 26 24">
        <path d="M4.84314 5V19H20.8431V7H12.4289L10.4289 5H4.84314ZM13.2573 5H21.8431C22.3954 5 22.8431 5.44772 22.8431 6V20C22.8431 20.5523 22.3954 21 21.8431 21H3.84314C3.29086 21 2.84314 20.5523 2.84314 20V4C2.84314 3.44772 3.29086 3 3.84314 3H11.2573L13.2573 5Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-file" viewBox="0 0 1024 1024">
        <path d="M888.494817 313.882803l-198.019982-198.019982c-7.992021-7.992021-20.957311-7.992021-28.949332 0s-7.992021 20.947078 0 28.939099l163.084309 163.084309-215.794811 0L608.814999 42.686195c0-11.307533-9.15859-20.466124-20.466124-20.466124l-408.094512 0c-11.307533 0-20.466124 9.15859-20.466124 20.466124l0 938.62761c0 11.2973 9.15859 20.466124 20.466124 20.466124l693.76067 0c11.307533 0 20.466124-9.168824 20.466124-20.466124l0-652.961452C894.481158 322.92883 892.332215 317.720202 888.494817 313.882803zM853.54891 960.847681l-652.828422 0L200.720488 63.152319l367.162264 0 0 265.200034c0 11.307533 9.168824 20.466124 20.466124 20.466124l265.200034 0L853.54891 960.847681z" p-id="2051"></path>
   </symbol>
   <symbol id="icon-import-btn" viewBox="0 0 20 20">
        <path d="M17.1725 2V6H15.9078V3.33333H3.26528V16.6667H15.9091L15.9085 14H17.1731V18H2V2H17.1725ZM9.7824 7.33333V9.33333H18V10.6667H9.78112V12.6667L6.62016 10L9.78176 7.33333H9.7824Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-local-res" viewBox="0 0 24 24">
        <path d="M2.1 3.52505V15.825H21.9V3.52505H2.1ZM1.5 1.42505H22.5C23.4 1.42505 24 2.02505 24 2.92505V16.425C24 17.325 23.4 17.925 22.5 17.925H1.5C0.6 17.925 0 17.325 0 16.425V2.92505C0 2.02505 0.6 1.42505 1.5 1.42505ZM6.45 22.575C5.85 22.575 5.4 22.125 5.4 21.525C5.4 20.925 5.85 20.475 6.45 20.475H18C18.6 20.475 19.05 20.925 19.05 21.525C19.05 22.125 18.6 22.575 18 22.575H6.45Z" fill="currentColor"></path>
   </symbol>
   <symbol id="icon-location" viewBox="0 0 20 20">
        <path d="M9.18182 4.33073C6.67353 4.68951 4.68951 6.67353 4.33073 9.18182H5.90909V10.8182H4.33073C4.68951 13.3265 6.67353 15.3105 9.18182 15.6693V14.0909H10.8182V15.6693C13.3265 15.3105 15.3105 13.3265 15.6693 10.8182H14.0909V9.18182H15.6693C15.3105 6.67353 13.3265 4.68951 10.8182 4.33073V5.90909H9.18182V4.33073ZM2.68131 9.18182C3.05861 5.76867 5.76867 3.05861 9.18182 2.68131V1H10.8182V2.68131C14.2313 3.05861 16.9414 5.76867 17.3187 9.18182H19V10.8182H17.3187C16.9414 14.2313 14.2313 16.9414 10.8182 17.3187V19H9.18182V17.3187C5.76867 16.9414 3.05861 14.2313 2.68131 10.8182H1V9.18182H2.68131ZM11.6364 10C11.6364 10.9038 10.9038 11.6364 10 11.6364C9.09624 11.6364 8.36364 10.9038 8.36364 10C8.36364 9.09624 9.09624 8.36364 10 8.36364C10.9038 8.36364 11.6364 9.09624 11.6364 10Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-more" viewBox="0 0 20 20">
        <path d="M10 4C9.45 4 9 4.45 9 5C9 5.55 9.45 6 10 6C10.55 6 11 5.55 11 5C11 4.45 10.55 4 10 4ZM10 14C9.45 14 9 14.45 9 15C9 15.55 9.45 16 10 16C10.55 16 11 15.55 11 15C11 14.45 10.55 14 10 14ZM10 9C9.45 9 9 9.45 9 10C9 10.55 9.45 11 10 11C10.55 11 11 10.55 11 10C11 9.45 10.55 9 10 9Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-hori-more" viewBox="0 0 1024 1024">
    <path d="M288 456.864A63.264 63.264 0 0 0 256 448a64 64 0 1 0 0 128c11.712 0 22.56-3.392 32-8.896 19.04-11.072 32-31.488 32-55.104 0-23.648-12.96-44.064-32-55.136M544 456.864A63.264 63.264 0 0 0 512 448c-11.712 0-22.56 3.36-32 8.864-19.04 11.072-32 31.488-32 55.136 0 23.616 12.96 44.032 32 55.104 9.44 5.504 20.288 8.896 32 8.896s22.56-3.392 32-8.896c19.04-11.072 32-31.488 32-55.104 0-23.648-12.96-44.064-32-55.136M768 448c-11.712 0-22.56 3.392-32 8.864-19.04 11.104-32 31.52-32 55.136 0 23.616 12.96 44.032 32 55.136 9.44 5.472 20.288 8.864 32 8.864a64 64 0 1 0 0-128" fill="currentColor" p-id="5791">
    </path>
   </symbol>

   <symbol id="icon-community-manage-btn" viewBox="0 0 25 25">
        <g clip-path="url(#clip0_464_566)">
        <path d="M24.8423 12.2701C24.8423 10.1171 24.2543 8.01507 23.1523 6.16107C23.5773 5.64306 23.8423 4.99007 23.8423 4.27007C23.8423 2.61607 22.4963 1.27007 20.8423 1.27007C20.1213 1.27007 19.4683 1.53607 18.9513 1.96107C15.2373 -0.235935 10.4483 -0.234935 6.73426 1.96107C6.21626 1.53607 5.56326 1.27007 4.84326 1.27007C3.18926 1.27007 1.84326 2.61607 1.84326 4.27007C1.84326 4.99007 2.10926 5.64306 2.53326 6.16107C1.43026 8.01607 0.843262 10.1181 0.843262 12.2701C0.843262 14.4221 1.43126 16.5241 2.53326 18.3791C2.10826 18.8971 1.84326 19.5501 1.84326 20.2701C1.84326 21.9241 3.18926 23.2701 4.84326 23.2701C5.56326 23.2701 6.21626 23.0051 6.73426 22.5801C8.58926 23.6821 10.6903 24.2701 12.8433 24.2701C14.9963 24.2701 17.0983 23.6821 18.9523 22.5801C19.4703 23.0051 20.1233 23.2701 20.8433 23.2701C22.4973 23.2701 23.8433 21.9241 23.8433 20.2701C23.8433 19.5501 23.5773 18.8971 23.1533 18.3791C24.2553 16.5251 24.8423 14.4231 24.8423 12.2701ZM22.8423 4.27007C22.8423 5.37307 21.9453 6.27007 20.8423 6.27007C19.7393 6.27007 18.8423 5.37307 18.8423 4.27007C18.8423 3.16707 19.7393 2.27007 20.8423 2.27007C21.9453 2.27007 22.8423 3.16707 22.8423 4.27007ZM4.84226 2.27007C5.94526 2.27007 6.84226 3.16707 6.84226 4.27007C6.84226 5.37307 5.94526 6.27007 4.84226 6.27007C3.73926 6.27007 2.84226 5.37307 2.84226 4.27007C2.84226 3.16707 3.73926 2.27007 4.84226 2.27007ZM2.84226 20.2701C2.84226 19.1671 3.73926 18.2701 4.84226 18.2701C5.94526 18.2701 6.84226 19.1671 6.84226 20.2701C6.84226 21.3731 5.94526 22.2701 4.84226 22.2701C3.73926 22.2701 2.84226 21.3731 2.84226 20.2701ZM7.41126 21.7951C7.67826 21.3461 7.84226 20.8291 7.84226 20.2701C7.84226 18.6161 6.49626 17.2701 4.84226 17.2701C4.28226 17.2701 3.76426 17.4341 3.31526 17.7021C2.36526 16.0401 1.84226 14.1801 1.84226 12.2701C1.84226 10.3601 2.36526 8.49907 3.31526 6.83807C3.76426 7.10607 4.28226 7.27007 4.84226 7.27007C6.49626 7.27007 7.84226 5.92407 7.84226 4.27007C7.84226 3.71107 7.67826 3.19407 7.41126 2.74507C10.7393 0.853065 14.9443 0.853065 18.2733 2.74507C18.0063 3.19407 17.8423 3.71107 17.8423 4.27007C17.8423 5.92407 19.1883 7.27007 20.8423 7.27007C21.4023 7.27007 21.9203 7.10607 22.3693 6.83807C23.3193 8.49907 23.8423 10.3591 23.8423 12.2701C23.8423 14.1811 23.3193 16.0411 22.3693 17.7021C21.9203 17.4341 21.4023 17.2701 20.8423 17.2701C19.1883 17.2701 17.8423 18.6161 17.8423 20.2701C17.8423 20.8291 18.0063 21.3471 18.2733 21.7951C14.9453 23.6871 10.7393 23.6871 7.41126 21.7951ZM20.8423 22.2701C19.7393 22.2701 18.8423 21.3731 18.8423 20.2701C18.8423 19.1671 19.7393 18.2701 20.8423 18.2701C21.9453 18.2701 22.8423 19.1671 22.8423 20.2701C22.8423 21.3731 21.9453 22.2701 20.8423 22.2701ZM12.8423 5.27007C8.98226 5.27007 5.84226 8.41107 5.84226 12.2701C5.84226 16.1291 8.98226 19.2701 12.8423 19.2701C16.7023 19.2701 19.8423 16.1291 19.8423 12.2701C19.8423 8.41107 16.7013 5.27007 12.8423 5.27007ZM18.8173 11.7701H15.6833C15.6283 9.73606 15.2403 7.74807 14.5343 6.51707C16.8663 7.20407 18.6103 9.27106 18.8173 11.7701ZM12.8423 18.2701C12.1243 18.2701 11.1073 16.1351 11.0103 12.7701H14.6733C14.5773 16.1351 13.5603 18.2701 12.8423 18.2701ZM11.0103 11.7701C11.1063 8.40507 12.1233 6.27007 12.8423 6.27007C13.5613 6.27007 14.5773 8.40507 14.6733 11.7701H11.0103ZM11.1493 6.51707C10.4433 7.74807 10.0553 9.73606 10.0003 11.7701H6.86726C7.07526 9.27106 8.81726 7.20407 11.1493 6.51707ZM6.86726 12.7701H10.0003C10.0553 14.8041 10.4433 16.7921 11.1493 18.0231C8.81726 17.3361 7.07426 15.2691 6.86726 12.7701ZM14.5343 18.0231C15.2403 16.7921 15.6283 14.8041 15.6833 12.7701H18.8173C18.6093 15.2691 16.8663 17.3361 14.5343 18.0231Z" fill="currentColor"></path>
        </g>
   </symbol>
   <symbol id="icon-notification" viewBox="0 0 23 24">
        <path d="M17.5 9.5C17.5 6.18629 14.8137 3.5 11.5 3.5C8.18629 3.5 5.5 6.18629 5.5 9.5V17.5H17.5V9.5ZM19.5 18.1667L19.9 18.7C20.0657 18.9209 20.0209 19.2343 19.8 19.4C19.7135 19.4649 19.6082 19.5 19.5 19.5H3.5C3.22386 19.5 3 19.2761 3 19C3 18.8918 3.03509 18.7865 3.1 18.7L3.5 18.1667V9.5C3.5 5.08172 7.08172 1.5 11.5 1.5C15.9183 1.5 19.5 5.08172 19.5 9.5V18.1667ZM9 20.5H14C14 21.8807 12.8807 23 11.5 23C10.1193 23 9 21.8807 9 20.5Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-plugin-btn" viewBox="0 0 25 25">
        <path d="M13.8433 18.3137V20.3137H19.8433V22.3137H13.8433C12.7387 22.3137 11.8433 21.4183 11.8433 20.3137V18.3137H8.84326C6.63412 18.3137 4.84326 16.5228 4.84326 14.3137V7.31369C4.84326 6.76141 5.29098 6.31369 5.84326 6.31369H8.84326V2.31369H10.8433V6.31369H14.8433V2.31369H16.8433V6.31369H19.8433C20.3956 6.31369 20.8433 6.76141 20.8433 7.31369V14.3137C20.8433 16.5228 19.0524 18.3137 16.8433 18.3137H13.8433ZM8.84326 16.3137H16.8433C17.9479 16.3137 18.8433 15.4183 18.8433 14.3137V11.3137H6.84326V14.3137C6.84326 15.4183 7.73869 16.3137 8.84326 16.3137ZM18.8433 8.31369H6.84326V9.31369H18.8433V8.31369ZM12.8433 14.8137C12.291 14.8137 11.8433 14.366 11.8433 13.8137C11.8433 13.2614 12.291 12.8137 12.8433 12.8137C13.3956 12.8137 13.8433 13.2614 13.8433 13.8137C13.8433 14.366 13.3956 14.8137 12.8433 14.8137Z" fill="currentColor"></path>
   </symbol>
   <symbol id="icon-theme-prompt-btn" viewBox="0 0 24 24">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.5 6.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-7 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm2.5 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" fill="currentColor"></path>
   </symbol>
   <symbol id="icon-preview" viewBox="0 0 24 24">
        <path d="M10.9995 4H21V5.9995H10.9995V4ZM10.9995 7.999H16.9995V10H10.9995V7.999ZM10.9995 13.999H21V16H10.9995V13.999ZM10.9995 17.9995H16.9995V19.999H10.9995V17.9995ZM3 4H9V10H3V4ZM4.9995 5.9995V7.999H7.0005V5.9995H4.9995ZM3 13.999H9V19.999H3V13.999ZM4.9995 16V17.9995H7.0005V16H4.9995Z" fill="currentColor"></path>
   </symbol>
   <symbol id="icon-red-dot" viewBox="0 0 24 25">
        <path
        d="M12 17.5C14.7614 17.5 17 15.2614 17 12.5C17 9.73857 14.7614 7.5 12 7.5C9.23857 7.5 7 9.73857 7 12.5C7 15.2614 9.23857 17.5 12 17.5Z"
        fill="currentColor"></path>
   </symbol>
   <symbol id="icon-remote-server" viewBox="0 0 24 26">
        <path d="M18.5578 16.8904L11.8645 10.1972V9.19321L18.5578 2.5L19.5618 3.42032L13.2869 9.69522L19.5618 15.8864L18.5578 16.8904ZM5.00399 8.7749L11.8645 15.6355V16.5558L5.00399 23.5L4 22.496L10.4422 16.1374L4 9.69522L5.00399 8.7749Z" fill="currentColor"></path>
   </symbol>
   <symbol id="icon-right" viewBox="0 0 24 26">
        <path d="M12.9498 13.3344L8 8.38467L9.41422 6.97046L15.7782 13.3344L9.41422 19.6983L8 18.2841L12.9498 13.3344Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-search" viewBox="0 0 26 25">
        <path d="M18.8741 16.6168L23.1568 20.8995L21.7426 22.3137L17.4599 18.031C15.92 19.263 13.9671 20 11.8431 20C6.87514 20 2.84314 15.968 2.84314 11C2.84314 6.032 6.87514 2 11.8431 2C16.8111 2 20.8431 6.032 20.8431 11C20.8431 13.124 20.1061 15.0769 18.8741 16.6168ZM16.8678 15.8748C18.0906 14.6146 18.8431 12.8956 18.8431 11C18.8431 7.1325 15.7106 4 11.8431 4C7.97564 4 4.84314 7.1325 4.84314 11C4.84314 14.8675 7.97564 18 11.8431 18C13.7387 18 15.4577 17.2475 16.7179 16.0247L16.8678 15.8748Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-settings" viewBox="0 0 24 24">
        <path d="M2 11.8615C2 10.997 2.1097 10.1581 2.31595 9.358C3.40622 9.41452 4.48848 8.87184 5.0718 7.86151C5.65467 6.85194 5.58406 5.6444 4.99121 4.7287C6.18354 3.55698 7.66832 2.68191 9.32603 2.22302C9.8222 3.19554 10.8333 3.86151 12 3.86151C13.1667 3.86151 14.1778 3.19554 14.674 2.22302C16.3317 2.68191 17.8165 3.55698 19.0088 4.7287C18.4159 5.6444 18.3453 6.85194 18.9282 7.86151C19.5115 8.87184 20.5938 9.41452 21.6841 9.358C21.8903 10.1581 22 10.997 22 11.8615C22 12.726 21.8903 13.5649 21.6841 14.365C20.5938 14.3085 19.5115 14.8512 18.9282 15.8615C18.3453 16.8711 18.4159 18.0786 19.0088 18.9943C17.8165 20.166 16.3317 21.0411 14.674 21.5C14.1778 20.5275 13.1667 19.8615 12 19.8615C10.8333 19.8615 9.8222 20.5275 9.32603 21.5C7.66832 21.0411 6.18354 20.166 4.99121 18.9943C5.58406 18.0786 5.65467 16.8711 5.0718 15.8615C4.48848 14.8512 3.40622 14.3085 2.31595 14.365C2.1097 13.5649 2 12.726 2 11.8615ZM6.80385 14.8615C7.43395 15.9529 7.61458 17.2076 7.36818 18.3853C7.77597 18.6755 8.21005 18.9269 8.66489 19.1358C9.56176 18.3329 10.7392 17.8615 12 17.8615C13.2608 17.8615 14.4382 18.3329 15.3351 19.1358C15.7899 18.9269 16.224 18.6755 16.6318 18.3853C16.3854 17.2076 16.566 15.9529 17.1962 14.8615C17.8262 13.7702 18.8225 12.9865 19.9655 12.611C19.9884 12.3632 20 12.1133 20 11.8615C20 11.6098 19.9884 11.3598 19.9655 11.1121C18.8225 10.7366 17.8262 9.95289 17.1962 8.86151C16.566 7.77014 16.3854 6.51547 16.6318 5.33774C16.224 5.04757 15.7899 4.79616 15.3351 4.58721C14.4382 5.39013 13.2608 5.86151 12 5.86151C10.7392 5.86151 9.56176 5.39013 8.66489 4.58721C8.21005 4.79616 7.77597 5.04757 7.36818 5.33774C7.61458 6.51547 7.43395 7.77014 6.80385 8.86151C6.17376 9.95289 5.17754 10.7366 4.03451 11.1121C4.01157 11.3598 4 11.6098 4 11.8615C4 12.1133 4.01157 12.3632 4.03451 12.611C5.17754 12.9865 6.17376 13.7702 6.80385 14.8615ZM12 14.8615C10.3431 14.8615 9 13.5184 9 11.8615C9 10.2047 10.3431 8.86151 12 8.86151C13.6569 8.86151 15 10.2047 15 11.8615C15 13.5184 13.6569 14.8615 12 14.8615ZM12 12.8615C12.5523 12.8615 13 12.4138 13 11.8615C13 11.3092 12.5523 10.8615 12 10.8615C11.4477 10.8615 11 11.3092 11 11.8615C11 12.4138 11.4477 12.8615 12 12.8615Z" fill="currentColor"/>
   </symbol>
   <symbol id="icon-user-btn" viewBox="0 0 24 24">
        <path d="M4.99509 3C3.89262 3 3 3.89323 3 4.99509V19.0049C3 20.1074 3.89323 21 4.99509 21H19.0049C20.1074 21 21 20.1068 21 19.0049V4.99509C21 3.89262 20.1068 3 19.0049 3H4.99509ZM5 19V5H19V19H5ZM12 8C12.5523 8 13 8.44772 13 9C13 9.55228 12.5523 10 12 10C11.4477 10 11 9.55228 11 9C11 8.44772 11.4477 8 12 8ZM12 12C13.6569 12 15 10.6569 15 9C15 7.34315 13.6569 6 12 6C10.3431 6 9 7.34315 9 9C9 10.6569 10.3431 12 12 12ZM12 15C10.8954 15 10 15.8954 10 17H8C8 14.7909 9.79086 13 12 13C14.2091 13 16 14.7909 16 17H14C14 15.8954 13.1046 15 12 15Z" fill="currentColor"></path>
   </symbol>
   <symbol id="icon-view-code" viewBox="0 0 24 24">
        <path d="M3.46114 11.9535L8.15771 7.33067L6.95543 6.10896L1 11.9707L6.96343 17.6804L8.14914 16.4421L3.46114 11.9535ZM15.2857 7.33067L16.488 6.10896L22.4434 11.9707L16.48 17.6804L15.2943 16.4421L19.9823 11.9535L15.2857 7.33067ZM12.6377 5.31067L9.09143 18.2347L10.7446 18.6884L14.2909 5.76495L12.6377 5.31124V5.31067Z" fill="currentColor"></path>
   </symbol>
   <symbol id="icon-locked" viewBox="0 0 1024 1024">
        <path d="M234.666667 533.354667V874.666667a21.333333 21.333333 0 0 0 21.333333 21.333333h512c11.733333 0 21.333333-9.6 21.333333-21.354667V533.333333a21.333333 21.333333 0 0 0-21.333333-21.333333H256c-11.733333 0-21.333333 9.6-21.333333 21.354667zM256 426.666667v-128c0-141.397333 114.602667-256 256-256 141.418667 0 256 114.56 256 256v128a106.666667 106.666667 0 0 1 106.666667 106.688V874.666667a106.730667 106.730667 0 0 1-106.666667 106.666666H256a106.666667 106.666667 0 0 1-106.666667-106.688V533.333333a106.730667 106.730667 0 0 1 106.666667-106.666666z m85.333333 0h341.333334v-128c0-94.314667-76.373333-170.666667-170.666667-170.666667a170.666667 170.666667 0 0 0-170.666667 170.666667v128z" p-id="5337">
	   </path>
   </symbol>
     <symbol id="icon-fork" viewBox="0 0 1024 1024">
          <path d="M384 334.08V512h128a128 128 0 0 0 128-128V334.08a128.042667 128.042667 0 1 1 85.333333 0V384a213.333333 213.333333 0 0 1-213.333333 213.333333H384v92.586667a128.042667 128.042667 0 1 1-85.333333 0V334.08a128.042667 128.042667 0 1 1 85.333333 0zM341.333333 853.333333a42.666667 42.666667 0 1 0 0-85.333333 42.666667 42.666667 0 0 0 0 85.333333z m341.333334-597.333333a42.666667 42.666667 0 1 0 0-85.333333 42.666667 42.666667 0 0 0 0 85.333333zM341.333333 256a42.666667 42.666667 0 1 0 0-85.333333 42.666667 42.666667 0 0 0 0 85.333333z" fill="currentColor" p-id="2129">
          </path>
     </symbol>
   <!-- ===================== File Type Icons ===================== -->
   <symbol id="icon-file-js" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="9" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">JS</text>
   </symbol>
   <symbol id="icon-file-ts" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="9" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">TS</text>
   </symbol>
   <symbol id="icon-file-json" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="9" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">{ }</text>
   </symbol>
   <symbol id="icon-file-html" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="8" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">&lt;/&gt;</text>
   </symbol>
   <symbol id="icon-file-css" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">#</text>
   </symbol>
   <symbol id="icon-file-md" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">MD</text>
   </symbol>
   <symbol id="icon-file-image" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M8 15l2.5-4 2.5 3 2-2.5L18 15v1H8v-1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="10" cy="10" r="1" fill="currentColor" opacity="0.5"/>
   </symbol>
   <symbol id="icon-file-pdf" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M9 10a1 1 0 0 1 1-1h1.5c.8 0 1.5.7 1.5 1.5v0c0 .8-.7 1.5-1.5 1.5H10v2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M13 12v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M14 12h.5c.8 0 1.5.7 1.5 1.5v1c0 .8-.7 1.5-1.5 1.5H14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
   </symbol>
   <symbol id="icon-file-zip" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M10 8h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M10 11h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M10 14l4-2v4l-4-2z" fill="currentColor" opacity="0.5"/>
   </symbol>
   <symbol id="icon-file-py" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M10 8c0-.5.5-1 1-1h2c.5 0 1 .5 1 1v2c0 .5-.5 1-1 1h-2c-.5 0-1 .5-1 1v2c0 .5.5 1 1 1h2c.5 0 1-.5 1-1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M13 8V7M11 16v-1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
   </symbol>
   <symbol id="icon-file-java" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M10 12c-.5.5-1 .8-1.5 1.2-.5.4-.5 1.3 0 1.8.5.5 1.3.5 1.8 0s.8-1 1.2-1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M14 11c.7.5 1 1.2 1 2 0 .8-.5 1.5-1.5 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M8 8h8v3H8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
   </symbol>
   <symbol id="icon-file-cpp" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="8" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">C++</text>
   </symbol>
   <symbol id="icon-file-xml" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="8" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">&lt;&gt;</text>
   </symbol>
   <symbol id="icon-file-txt" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M8 9h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M8 12h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M8 15h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
   </symbol>
   <symbol id="icon-file-config" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <circle cx="12" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M12 7v2M12 15v2M7 12h2M15 12h2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
   </symbol>
   <symbol id="icon-file-sh" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="9" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">$_</text>
   </symbol>
   <symbol id="icon-file-bat" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="9" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">BAT</text>
   </symbol>
   <symbol id="icon-file-go" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">Go</text>
   </symbol>
   <symbol id="icon-file-rs" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">RS</text>
   </symbol>
   <symbol id="icon-file-php" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">PHP</text>
   </symbol>
   <symbol id="icon-file-rb" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M9 11v5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M9 11h1.5c.8 0 1.5.7 1.5 1.5v0c0 .8-.7 1.5-1.5 1.5H9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M13 11l2 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
   </symbol>
   <symbol id="icon-file-swift" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="9" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">SW</text>
   </symbol>
   <symbol id="icon-file-kt" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M8 8v8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M16 8l-6 5 6 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
   </symbol>
   <symbol id="icon-file-dart" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="9" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">DA</text>
   </symbol>
   <symbol id="icon-file-svelte" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="9" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">SV</text>
   </symbol>
   <symbol id="icon-file-vue" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M5 8l7 10 7-10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8 8l4 6 4-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
   </symbol>
   <symbol id="icon-file-sql" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <ellipse cx="12" cy="10" rx="3.5" ry="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M8.5 10v4c0 .8 1.6 1.5 3.5 1.5s3.5-.7 3.5-1.5v-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
   </symbol>
   <symbol id="icon-file-csv" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M8 8h8v8H8z" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M8 11h8M11 8v8" fill="none" stroke="currentColor" stroke-width="1" opacity="0.5"/>
   </symbol>
   <symbol id="icon-file-lock" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <rect x="9" y="11" width="6" height="5" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M10 11V9.5a2 2 0 0 1 4 0V11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
   </symbol>
   <symbol id="icon-file-env" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M8 9h8M8 12h8M8 15h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M10 7v2M14 11v2M12 14v2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
   </symbol>
   <symbol id="icon-file-git" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M9 8v8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M15 8v8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M9 12h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="9" cy="8" r="1.5" fill="none" stroke="currentColor" stroke-width="1"/>
      <circle cx="15" cy="8" r="1.5" fill="none" stroke="currentColor" stroke-width="1"/>
   </symbol>
   <symbol id="icon-file-docker" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M10 10h1v-1h-1v1zM12 10h1v-1h-1v1zM14 10h1v-1h-1v1z" fill="currentColor" opacity="0.4"/>
      <path d="M9 11h1v-1H9v1zM11 11h1v-1h-1v1zM13 11h1v-1h-1v1zM15 11h1v-1h-1v1z" fill="currentColor" opacity="0.4"/>
      <path d="M8 12h1v-1H8v1zM10 12h1v-1h-1v1zM12 12h1v-1h-1v1z" fill="currentColor" opacity="0.4"/>
      <path d="M7 14c2.5 0 4.5-.5 6-2 1-1 1.5-2.5 1.5-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
   </symbol>
   <symbol id="icon-file-sol" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="8" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">SOL</text>
   </symbol>
   <symbol id="icon-file-gradle" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">GR</text>
   </symbol>
   <symbol id="icon-file-yarn" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">YA</text>
   </symbol>
   <symbol id="icon-file-npm" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">NP</text>
   </symbol>
   <symbol id="icon-file-node" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">ND</text>
   </symbol>
   <symbol id="icon-file-rust" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">RU</text>
   </symbol>
   <symbol id="icon-file-haskell" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M8 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
   </symbol>
   <symbol id="icon-file-lua" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">LU</text>
   </symbol>
   <symbol id="icon-file-elixir" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <text x="12" y="16" font-size="10" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial,sans-serif">EX</text>
   </symbol>
   <symbol id="icon-file-graphql" viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.06"/>
      <path d="M12 7l-4.5 2.5v5L12 17l4.5-2.5v-5L12 7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 7v10" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"/>
   </symbol>
</svg>
`.trim();


// svg-injector.ts
let hasInjected = false;
let dynamicSvgContainer: SVGElement | null = null;

export function injectSvgSprite() {
  if (hasInjected || typeof document === 'undefined') return;

  const container = document.createElement('div');
  container.innerHTML = SVG_SPRITE_CONTENT;
  container.style.display = 'none';
  document.body.appendChild(container);

  const svg = container.querySelector('svg');
  if (svg) {
    dynamicSvgContainer = svg;
  }

  hasInjected = true;
}

export function addDynamicFileIconSymbol(extension: string, svgPath: string): string {
  const symbolId = `icon-file-theme-${extension}`;
  if (typeof document === 'undefined') return symbolId;
  if (!dynamicSvgContainer) {
    dynamicSvgContainer = document.querySelector('svg[style*="display: none"]') as SVGElement;
  }
  if (!dynamicSvgContainer) return symbolId;
  const existing = dynamicSvgContainer.querySelector(`#${CSS.escape(symbolId)}`);
  if (existing) {
    existing.innerHTML = `<path d="${svgPath}" fill="currentColor"/>`;
    return symbolId;
  }
  const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
  symbol.setAttribute('id', symbolId);
  symbol.setAttribute('viewBox', '0 0 24 24');
  symbol.setAttribute('fill', 'currentColor');
  symbol.innerHTML = `<path d="${svgPath}" fill="currentColor"/>`;
  dynamicSvgContainer.appendChild(symbol);
  return symbolId;
}
