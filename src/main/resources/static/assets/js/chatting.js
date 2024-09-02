'use strict'; // 스크립트 사용을 알림: 엄격 모드(오류 찾기에 유용)

const chatRoomUsersList = document.querySelector('#v-pills-chatrooms .chat_list');// 사용자(방) 목록 영역
const chatRoom= document.querySelector('#chatRoom'); // 채팅방 영역
const chatArea = document.querySelector('#chatArea'); // 채팅 영역
const messageInput = document.querySelector('#messageInput'); // 메시지 입력창
const sendButton = document.querySelector('.send_button'); // 채팅 전송 버튼
const backButton = document.querySelector('#backButton'); // 채팅방 닫기 버튼
const chatModal = document.getElementById('chatModal'); // 생성 모달 창
const closeButton = document.getElementById('closeButton'); // 생성 모달 창 닫기 버튼
const confirmCreateRoomButton = document.getElementById('confirmCreateRoom'); // 채팅방 생성 확인 버튼
const exitChatRoomModal = document.getElementById('exitChatRoomModal'); // 나가기 모달 창
const closeExitModalButton = document.getElementById('closeExitModalButton'); // 나가기 모달 창 닫기 버튼
const confirmExitRoomButton = document.getElementById('confirmExitRoomButton'); // 나가기 확인 버튼
const exitButton = document.querySelector('#exitButton'); // 채팅방 나가기 버튼
const dropdownMenu = document.querySelector('.chat_menu_container .dropdown-menu'); // 오른쪽 마우스-드롭다운메뉴

let stompClient = null; // 클라이언트 객체 생성
const empNo = sessionStorage.getItem('empNo') || new URLSearchParams(window.location.search).get('empNo'); // 접속 사원
let selectedEmpNo = null; // 선택된 사원
let selectedEmployeeInfo = null; // 선택된 사원의 정보
let unreadMessages = {}; // 안 읽은 메시지를 사용자별로 저장
let reconnectAttempts = 0; // 소켓 재연결 시도 횟수
let maxReconnectAttempts = 5; // 최대 재연결 시도 횟수
let reconnectInterval = 5000; // 재연결 시도 간격(밀리초)

document.addEventListener('DOMContentLoaded', function() {
    connectSocket(); // 소켓 연결 시도
    setupSearchFilters(); // 검색 필터
    toggleSendButton(); // 전송버튼 활성화/비활성화
    findAndDisplayConnectedUsers(); // 기존 방 목록 호출 및 초기화

    // 페이지 전체에 오른쪽 마우스 클릭 기본 이벤트 막기
    document.addEventListener('contextmenu', function(event) {
        event.preventDefault();
    });

    // 부모 창으로부터 메시지를 받는 이벤트 리스너
    window.addEventListener('message', function(event){
        if (event.data.type === 'LOGOUT') {
            onLogout();
        } else if (event.data.type === 'UPDATE_ALARM' || event.data.type === 'INITIAL_ALARM') {
            updateAlarmUI(event.data.unreadMessages); // 부모 창에서 받은 알람 상태 업데이트
            console.log("상태 업데이트 1-2 업데이트 알람")
            console.log(event.data.unreadMessages);

            // menu_alarm 클래스 업데이트
            const totalUnreadMessages = Object.values(event.data.unreadMessages).reduce((a, b) => a + b, 0);
            const menuAlarm = document.querySelector('.menu_alarm');
            if (totalUnreadMessages > 0) {
                menuAlarm.textContent = totalUnreadMessages;
                menuAlarm.classList.remove('hidden');
            } else {
                menuAlarm.textContent = '0';
                menuAlarm.classList.add('hidden');
            }
        } else if (event.data.type === 'RESET_ALARM') {
            // 자식 창에서 알람 수를 초기화
            updateAlarmUI({ [selectedEmpNo]: 0 });
        } else {
            const message = event.data;
            displayMessage(message.senderEmpNo, message.chatContent);
        }
    });

    // 자식 창이 활성화되었을 때 알림 처리
    window.addEventListener('focus', function() {
        if (selectedEmpNo) {
            markMessagesAsRead(selectedEmpNo); // 현재 열려 있는 채팅창에 대한 알림 제거
            selectChatUser(selectedEmpNo); // 부모 창에 알림 제거 요청
        }
        // 현재 선택된 사원의 알람이 초기화되도록 부모 창에 상태 전달
        if (window.opener) {
            window.opener.postMessage({ type: 'RESET_ALARM', empNo: selectedEmpNo }, '*');
        }
    });
    // 자식 창이 비활성화되었을 때 부모 창에 알림 전달
    window.addEventListener('blur', function() {
        if (selectedEmpNo && window.opener) {
            window.opener.postMessage({ type: 'UPDATE_ALARM', unreadMessages: unreadMessages }, '*');
        }
    });

    messageInput.addEventListener('input', toggleSendButton);
    // 채팅 전송
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            sendMessage();
            event.preventDefault();
        }
    });
    // 채팅방 닫기
    backButton.addEventListener('click', closeChat);
    document.addEventListener('keydown', function escListener(event) {
        if (event.key === 'Escape') {
            closeChat();
        }
    });

    // 채팅방 나가기: 모달 창 열기
    exitButton.addEventListener('click', function() {
        openModal(exitChatRoomModal);
        confirmExitRoomButton.onclick = function() {
            exitChatRoom(empNo, selectedEmpNo);
            closeModal(exitChatRoomModal);
        };
    });

    // 채팅방 나가기: 모달 창 닫기
    closeExitModalButton.addEventListener('click', function() {
        closeModal(exitChatRoomModal);
    });

    // // 채팅방 나가기: 모달 창 확인 버튼
    // confirmExitRoomButton.addEventListener('click', function() {
    //     exitChatRoom(empNo, selectedEmpNo);
    //     closeModal(exitChatRoomModal); // 모달 창 닫기
    // });

    // 모달창 외부 클릭 시 닫기 (채팅방 생성 모달창)
    window.onclick = function(e) {
        if (e.target == chatModal) {
            closeModal(chatModal);
        } else if (e.target == exitChatRoomModal) { // 채팅방 나가기 모달창 닫기
            closeModal(exitChatRoomModal);
        }
    };

    // 조직도: 새 채팅방 생성
    document.querySelectorAll('.dep_emps_list span').forEach(link => {
        // 접속한 사원을 제외하고 숨김 처리
        const employeeEmpNo = link.getAttribute('data-empno');
        if (employeeEmpNo === empNo) {
            link.style.display = 'none';
        }
        link.addEventListener('click', handleEmployeeClick);
    });
    // 조직도: 부서 클릭 시 펼침/닫힘
    document.querySelectorAll('.org_dep').forEach(link => {
        link.addEventListener('click', toggleDepartment);
    });
});

// 소켓 연결 시도
function connectSocket() {
    if (empNo && !stompClient) {
        const socket = new SockJS('/ws');
        stompClient = Stomp.over(socket);
        stompClient.connect({}, onConnected, onError);
    }
}

// 소켓 연결(로그인) 성공
function onConnected() {
    reconnectAttempts = 0; // 연결 성공 시, 재연결 시도 횟수 초기화
    console.log('WebSocket 연결 성공');

    stompClient.subscribe(`/user/${empNo}/queue/messages`, onMessageReceived, (headers) => {
        console.log('메시지 구독 성공:', headers);
    }, (error) => {
        console.error('메시지 구독 실패:', error);
    });

    console.log('메시지 구독 설정 완료');

    requestAlarmStatus(); // 자식창 새로고침 시, 부모 창에 알람 상태 요청
}
// 소켓 연결 끊김
function onError() {
    console.error('WebSocket 서버에 연결할 수 없습니다. 다시 연결을 시도하는 중...');
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        setTimeout(() => {
            connectSocket(); // 재연결 시도
        }, reconnectInterval);
    } else {
        console.error('WebSocket 서버가 종료되었습니다. 재연결하려면 새로고침하세요.');
    }
}

// 자식창 새로고침 시, 부모 창에 알람 상태 요청
function requestAlarmStatus() {
    console.log("제대로 실행되구 있니?");
    if (window.opener) {
        window.opener.postMessage({ type: 'REQUEST_ALARM_STATUS' }, '*');
    } else if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        setTimeout(requestAlarmStatus, 1000); // 1초 후 재시도
    } else {
        console.error('알람을 불러오지 못했습니다.');
    }
}

// 사원 정보를 가져오는 비동기 함수 // ㅇㅇ
async function fetchEmployeeInfo(empNo) {
    try {
        const response = await fetch(`/employees/${empNo}`);
        if (response.ok) {
            return await response.json(); // 사원 정보 반환
        } else {
            console.error('사용자 정보를 불러오는 중 오류가 발생했습니다.');
            return null;
        }
    } catch (error) {
        console.error('사용자 정보를 불러오는 중 오류가 발생했습니다.', error);
        return null;
    }
}

// 수신 메시지 처리
async function onMessageReceived(payload) {
    console.log("onMessageReceived 호출됨");
    console.log(empNo);
    try {
        const message = JSON.parse(payload.body);
        console.log("수신된 메시지:", message);

        // 방이 존재하지 않으면 방을 새로 추가
        let existingChatRoom = document.getElementById(addEmpNoPrefix(message.senderEmpNo));
        if (!existingChatRoom) {
            const employeeInfo = await fetchEmployeeInfo(message.senderEmpNo);

            unreadMessages[message.senderEmpNo] = (unreadMessages[message.senderEmpNo] || 0) + 1; // 지우면 알람 안뜸
            // 이미 서버에 방이 있는지 확인하여 중복 생성 방지
            if (employeeInfo) {
                console.log("새 방 생성")
                await checkAndCreateRoom(message.senderEmpNo, employeeInfo.lastName, employeeInfo.firstName, employeeInfo.rankName);
            }
        } else { // 방이 존재하면
            // 현재 선택된 사원의 메시지일 경우에만 채팅창에 표시
            if (selectedEmpNo == message.senderEmpNo) { // '=='
                displayMessage(message.senderEmpNo, message.chatContent);
            } else { // 선택된 사원이 아닌 경우 알림만 업데이트
                // unreadMessages[message.senderEmpNo] = (unreadMessages[message.senderEmpNo] || 0) + 1;
                updateAlarmUI(unreadMessages);
            }
            updateLatestMessage(message.senderEmpNo); // 방목록에 최신 채팅 업데이트
        }
    } catch (error) {
        console.error('onMessageReceived 처리 중 오류 발생:', error);
    }
}

// 방이 중복 생성되지 않도록 서버에 방 존재 여부 확인 후 생성 //ㅇㅇ
async function checkAndCreateRoom(senderEmpNo, lastName, firstName, rankName) {
    try {
        const response = await fetch(`/chatrooms/checkRoomExistence?senderEmpNo=${empNo}&recipientEmpNo=${senderEmpNo}`);
        const roomExists = await response.json();
        console.log(" 새 채팅방 만들때 여기 오는감 1");

        if (!roomExists || roomExists) {  // 방이 삭제된 경우(false)거나, 방이 없는 경우(true)..?
            console.log(" 새 채팅방 만들때 여기 오는감 2");
            appendUserElement({
                empNo: senderEmpNo,
                lastName: lastName || '알 수 없음',
                firstName: firstName || '',
                rankName: rankName || ''
            });
            console.log(" 새 채팅방 만들때 여기 오는감 3");
            // 새로 생성된 방에 대해 알림 설정
            // const notifiedUser = document.querySelector(`#${addEmpNoPrefix(senderEmpNo)}`);
            // const roomAlarm = notifiedUser.querySelector('.room_alarm');
            // roomAlarm.classList.add('hidden');
            // roomAlarm.textContent = '0';
            // await markMessagesAsRead(senderEmpNo); // ㄴㄴ
            // if (unreadMessages[senderEmpNo] && unreadMessages[senderEmpNo] > 0) {
            //     updateAlarmUI(unreadMessages);  // 알림 업데이트
            // }
            // 방 생성 후 최신 메시지 가져오기
            updateLatestMessage(senderEmpNo);
        }
    } catch (error) {
        console.error('방 존재 여부 확인 중 오류가 발생했습니다.', error);
    }
}

// 방 목록에 최신 채팅 업데이트(서버)
async function updateLatestMessage(userId) {
    try {
        const userChatResponse = await fetch(`/messages/${empNo}/${userId}`); // 서버 요청
        const userChat = await userChatResponse.json(); // 서버 응답
        if (userChat.length > 0) {
            const latestMessage = userChat[userChat.length - 1];
            updateLatestMessageContent(userId, latestMessage.chatContent);
            findAndDisplayConnectedUsers();
        }
    } catch (error) {
        console.error('채팅 내용을 불러오는 중 오류가 발생했습니다.', error);
    }
    initializeContextMenu(); // 오른쪽 마우스 클릭: 드롭다운메뉴
}

// 방 목록에 최신 메시지 콘텐츠 업데이트
function updateLatestMessageContent(userId, messageContent) {
    const chatRoomItem = document.getElementById(addEmpNoPrefix(userId));
    if (chatRoomItem) {
        const roomContentElement = chatRoomItem.querySelector('.room_content');
        if (roomContentElement) {
            roomContentElement.textContent = messageContent; // 최신 메시지로 업데이트
        }
    }
}

// 알람 상태를 업데이트하는 함수
function updateAlarmUI(unreadMessages) {
    for (let empNo in unreadMessages) {
        console.log("알람 상태 업데이트 empNo"); // ㄴㄴ
        console.log(empNo);
        console.log("알람 상태 업데이트 unreadMessages"); // ㄴㄴ
        console.log(unreadMessages);
        const notifiedUser = document.querySelector(`#${addEmpNoPrefix(empNo)}`);
        console.log("notifiedUser");
console.log(notifiedUser);
        if (notifiedUser) {
            const roomAlarm = notifiedUser.querySelector('.room_alarm');
            console.log("알람 상태 업데이트 notifiedUser"); // ㄴㄴ
            console.log(notifiedUser);
            if (roomAlarm) {
                console.log("알람 상태 업데이트"); // ㄴㄴ
                console.log(roomAlarm);
                roomAlarm.textContent = unreadMessages[empNo].toString();
                roomAlarm.classList.remove('hidden');
            }
        }
    }
}

// 부모 창에 empNo 전달
function selectChatUser(empNo) {
    selectedEmpNo = empNo; // 현재 선택된 사원을 변경

    if (window.opener) {
        window.opener.postMessage({ type: 'SELECT_USER', empNo: empNo }, '*');
    }
}

// 채팅창을 닫을 때 selectedEmpNo 초기화 및 부모창에 전달
function closeChat() {
    chatRoom.classList.add('hidden'); // 채팅창 비활성화
    document.querySelector('.info_text').classList.remove('hidden'); // 안내 문구 활성화
    selectedEmpNo = null;
    // 부모 창에 초기화 상태 전달
    if (window.opener) {
        window.opener.postMessage({ type: 'RESET_SELECTED_USER' }, '*');
    }
}

// 방 목록 호출(서버)
async function findAndDisplayConnectedUsers() {
    const connectedUsersResponse = await fetch(`/chat/activeUsers?empNo=${empNo}`); // 사원의 대화 목록 호출
    let connectedUsers = await connectedUsersResponse.json(); // 서버 응답 데이터

    connectedUsers.forEach(user => { // 목록에 있는 사용자는 유지, 새롭게 추가된 채팅방만 생성
        let listItem = document.getElementById(addEmpNoPrefix(user.empNo));

        if (!listItem) { // 신규 사원 추가 (not null)
            appendUserElement(user); // 처음 추가될 때 방목록 생성
        } else { // 이미 존재하는 사용자의 알림 값 유지 (null)
            const roomAlarm = listItem.querySelector('.room_alarm');
            roomAlarm.textContent = roomAlarm.textContent || '0'; // 현재 값 유지
            // ㄴㄴ
        }
    });
    initializeContextMenu(); // 오른쪽 마우스 클릭: 드롭다운메뉴
}

// 방 목록 추가
function appendUserElement(user) {
    const listItem = document.createElement('div');
    listItem.classList.add('chat_room_item');
    listItem.id = addEmpNoPrefix(user.empNo);

    const roomImg = document.createElement('div');
    roomImg.className = "room_img";
    const img = document.createElement("img");
    img.src = "/assets/img/profile_m.png";
    img.alt = `${user.lastName}${user.firstName}`; // 사용자 이름 불러와야 함
    roomImg.appendChild(img);

    const roomInfo = document.createElement("ul");
    const roomName = document.createElement("li");
    roomName.className = "room_name";
    roomName.textContent = `${user.lastName}${user.firstName} ${user.rankName}님`; // 사용자 이름 불러와야 함
    const roomContent = document.createElement("li");
    roomContent.className = "room_content"; // 최근 메시지 표시
    roomContent.textContent = "";
    roomInfo.appendChild(roomName);
    roomInfo.appendChild(roomContent);

    const roomAlarm = document.createElement('span');
    roomAlarm.textContent = '0'; // 메시지 번호
    roomAlarm.classList.add('room_alarm', 'hidden'); // 메시지 알림 숨김

    listItem.appendChild(roomImg);
    listItem.appendChild(roomInfo);
    listItem.appendChild(roomAlarm);

    listItem.addEventListener('dblclick', roomItemClick); // 채팅방 선택

    chatRoomUsersList.appendChild(listItem);

    if (unreadMessages[user.empNo] && unreadMessages[user.empNo] > 0) {
        console.log("상태 업데이트 5-1 방 목록 추가할 때 appendUserElement")
        console.log(unreadMessages[user.empNo]);
        updateAlarmUI(unreadMessages);  // 알림 업데이트
        console.log("상태 업데이트 5-2 방 목록 추가할 때 appendUserElement")
        console.log(unreadMessages[user.empNo]);
    }
    // 새 채팅방 생성 시 기존 방목록의 최신 메시지를 업데이트하지 않음
    if (selectedEmpNo !== user.empNo) {
        updateLatestMessage(user.empNo); // 방목록에 최신 채팅 업데이트
    }
}

// 선택한 채팅방 활성화 준비
function roomItemClick(event) {
    // 모든 사람의 채팅창 가림
    document.querySelectorAll('.chat_room_item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector('.info_text').classList.add('hidden');

    const clickedUser = event.currentTarget; // event: 방 목록 html

    selectedEmpNo = removeEmpNoPrefix(clickedUser.getAttribute('id'));
    document.getElementById('chatRoomName').textContent = clickedUser.querySelector('.room_name').textContent;

    // 선택된 사용자의 메시지 알림 제거
    // roomAlarm = clickedUser.querySelector('.room_alarm');
    // roomAlarm.classList.add('hidden');
    // roomAlarm.textContent = '0';
    markMessagesAsRead(selectedEmpNo); // 서버에 알림 초기화를 요청

    chatRoom.classList.remove('hidden'); // 채팅창 활성화
    messageInput.value = ''; // 새로운 채팅방 열었을 때 입력값 비우기
    fetchAndDisplayUserChat(); // 사용자 채팅창 오픈
}

// 채팅 메시지 읽음 처리 //ㄴㄴ
async function markMessagesAsRead(userId) {
    let existingChatRoom = document.getElementById(addEmpNoPrefix(userId));
    // if (existingChatRoom) { // 방 있으면 알람 0
        const notifiedUser = document.querySelector(`#${addEmpNoPrefix(userId)}`);
        const roomAlarm = notifiedUser.querySelector('.room_alarm');
        roomAlarm.classList.add('hidden');
        roomAlarm.textContent = '0';
    // }

    await fetch(`/chatrooms/markAsRead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({senderEmpNo: empNo, recipientEmpNo: userId})
    });
    // 부모 창에 읽은 상태 전달
    if (window.opener) {
        window.opener.postMessage({ type: 'RESET_ALARM', empNo: userId }, '*');
    }
}

// 사용자 채팅창 오픈
async function fetchAndDisplayUserChat() {
    try {
        selectChatUser(selectedEmpNo); // 부모창에 선택된 사원 전달

        // 사용자 채팅 응답 상수 가져오기
        const userChatResponse = await fetch(`/messages/${empNo}/${selectedEmpNo}`);
        if (!userChatResponse.ok) {
            throw new Error(`Server error: ${userChatResponse.statusText}`);
        }
        const userChat = await userChatResponse.json(); // 채팅 응답 보관

        chatArea.innerHTML = ''; // 채팅 영역 비움

        if (userChat.length > 0) { // 채팅 내용이 있는지 확인 - 기존 채팅방만 동작
            // 채팅 내용 표시
            userChat.forEach(chat => {
                if (chat.chatContent) { // 채팅 내용이 있는 경우
                    displayMessage(chat.senderEmpNo, chat.chatContent);
                }
            });
            // 선택된 채팅방의 최신 메시지를 room_content에 표시
            updateLatestMessage(selectedEmpNo);
        }
        toggleSendButton();
    } catch (error) {
        console.error('채팅 내용을 불러오는 중 오류가 발생했습니다.', error);
        alert('채팅 내용을 불러오는 중 오류가 발생했습니다. 다시 시도해 주세요.');
    }
}

// 채팅창 메시지 표시
function displayMessage(senderEmpNo, chatContent) {
    const messageContainer = document.createElement('div');
    messageContainer.classList.add('chat_message'); // 메시지 클래스 지정

    // 보낸 사람과 닉네임이 동일한지 확인
    if (senderEmpNo == empNo) { // '==' 로 사용
        messageContainer.classList.add('chat_sender'); // 발신자
    } else {
        messageContainer.classList.add('chat_receiver'); // 수신자
    }
    const message = document.createElement('p'); // 메시지 내용 담을 요소
    message.textContent = chatContent; // 메시지 내용
    messageContainer.appendChild(message);
    chatArea.appendChild(messageContainer);

    // 선택된 채팅방의 최신 메시지를 room_content에 표시
    const activeChatRoom = document.getElementById(addEmpNoPrefix(selectedEmpNo));
    if (activeChatRoom) {
        activeChatRoom.querySelector('.room_content').textContent = chatContent;
    }
    chatArea.scrollTop = chatArea.scrollHeight; // 최신 스크롤 표시
}

// 메시지 전송 처리
function sendMessage() {
    // 방 목록에 해당 사용자가 이미 있는지 확인
    const existingChatRoom = document.getElementById(addEmpNoPrefix(selectedEmpNo));
    if (!existingChatRoom) { // 방이 존재하지 않으면
        newRoomChat(); // 방 추가, 알림
    }
    const messageContent = messageInput.value.trim();
    if (messageContent && stompClient) {
        const chatMessage = {
            senderEmpNo: empNo,
            recipientEmpNo: selectedEmpNo,
            chatContent: messageContent,
            chatSentTime: new Date()
        };
        // 메시지 서버에 전송
        stompClient.send("/app/chat", {}, JSON.stringify(chatMessage)); // 서버로 메시지 전송
        displayMessage(empNo, messageContent);
        messageInput.value = ''; // 채팅 입력창 초기화
        toggleSendButton();
    }
    initializeContextMenu();
}

// 방이 존재하지 않으면 방 추가, 채팅, 알림
function newRoomChat() {
    appendUserElement({  // 새 채팅방 목록에 추가
        empNo: selectedEmpNo,
        lastName: selectedEmployeeInfo.lastName,
        firstName: selectedEmployeeInfo.firstName,
        rankName: selectedEmployeeInfo.rankName
    });
}

// 새 채팅방: 사원 선택 시, 모달 창 열기, 채팅방 생성
function handleEmployeeClick(event) {
    // event.preventDefault();
    const link = event.currentTarget;

    selectedEmployeeInfo = {  // 선택된 사원의 정보 저장: 사원번호, 풀네임
        empNo: link.getAttribute('data-empno'),
        rankName: link.getAttribute('data-rank'),
        lastName: link.getAttribute('data-lastname'),
        firstName: link.getAttribute('data-firstname')
    };

    // 모달 창 열기
    openModal(chatModal);
    // 모달 창 닫기
    closeButton.onclick = function(){
        closeModal(chatModal);
    }
    // window.onclick = function(e) {
    //     if (e.target == chatModal) {
    //         closeModal(chatModal);
    //     }
    // }
    // 모달 창 확인: 채팅방 생성
    confirmCreateRoomButton.onclick = function() {
        closeModal(chatModal);
        newRoomItemClick(selectedEmployeeInfo);
    }
}

// 새 채팅방 : 선택한 사원 채팅방 생성
function newRoomItemClick(userId) {
    messageInput.value = ''; // 입력값 비우기

    // 모든 사람의 채팅창 가림
    document.querySelectorAll('.chat_room_item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector('.info_text').classList.add('hidden');

    selectedEmpNo = userId.empNo;
    document.getElementById('chatRoomName').textContent = `${userId.lastName}${userId.firstName} ${userId.rankName}님`; // 지우면 안됨 ㅎㅎ

    chatRoom.classList.remove('hidden'); // 채팅창 활성화
    fetchAndDisplayUserChat(); // 사용자 채팅창 오픈
}

// 채팅창 전송버튼 활성화/비활성화 처리
function toggleSendButton() {
    if (messageInput.value.trim() === '') { // 입력값이 없을 때
        sendButton.classList.add('disabled');
        sendButton.disabled = true; // 버튼 비활성화
    } else { // 입력값이 있을 때
        sendButton.classList.remove('disabled');
        sendButton.disabled = false; // 버튼 활성화
    }
}

// 모달 열기
function openModal(modal) {
    modal.classList.remove('hidden');
    hideDropdownMenu();
}
// 모달 닫기
function closeModal(modal) {
    modal.classList.add('hidden');
}

// 조직도: 부서 펼침/닫힘 토글
function toggleDepartment(event) {
    // event.preventDefault();
    const link = event.currentTarget;
    const empList = link.parentElement;

    if (empList.classList.contains('open')) {
        empList.classList.remove('open');
        empList.querySelector('.dep_emps_list').style.maxHeight = null;
    } else {
        empList.classList.add('open');
        const content = empList.querySelector('.dep_emps_list');
        content.style.maxHeight = content.scrollHeight + 'px';
    }
}

// 검색 필터
function setupSearchFilters() {
    const searchInputOrg = document.getElementById('searchInputOrg');
    const searchInputChatRoom = document.getElementById('searchInputChatRoom');

    // 조직도
    searchInputOrg.addEventListener('input', function () {
        applyFilter(searchInputOrg, '.org_dep_list > li', '.org_dep', '.dep_emps_list li');
    });

    // 방 목록
    searchInputChatRoom.addEventListener('input', function () {
        applyRoomFilter(searchInputChatRoom, '#v-pills-chatrooms .chat_room_item');
    });
}

// 검색 필터: 조직도
function applyFilter(inputElement, listSelector, nameSelector, itemSelector) {
    const filter = inputElement.value.toLowerCase();

    document.querySelectorAll(listSelector).forEach(dep => {
        const depName = dep.querySelector(nameSelector).textContent.toLowerCase();
        const empNames = dep.querySelectorAll(itemSelector);

        let depVisible = depName.includes(filter);
        let empVisible = false;

        empNames.forEach(emp => {
            const empName = emp.textContent.toLowerCase();
            emp.style.display = empName.includes(filter) || depVisible ? '' : 'none';
            if (emp.style.display !== 'none') empVisible = true;
        });

        if (depVisible || empVisible) {
            dep.style.display = '';
            dep.classList.add('open');
            dep.querySelector('.dep_emps_list').style.maxHeight = dep.querySelector('.dep_emps_list').scrollHeight + 'px';
        } else {
            dep.style.display = 'none';
        }

        if (!filter) {
            dep.classList.remove('open');
            dep.querySelector('.dep_emps_list').style.maxHeight = null;
        }
    });
}

// 검색 필터: 방 목록
function applyRoomFilter(inputElement, roomSelector) {
    const filter = inputElement.value.toLowerCase();

    document.querySelectorAll(roomSelector).forEach(room => {
        const roomName = room.querySelector('.room_name').textContent.toLowerCase();
        room.style.display = roomName.includes(filter) ? '' : 'none';
    });
}

// 오른쪽 마우스 클릭 관련 이벤트 초기화 함수
function initializeContextMenu() {
    chatRoomUsersList.querySelectorAll('.chat_room_item').forEach(Item => {
        Item.addEventListener('contextmenu', function(event) {

            hideDropdownMenu(); // 기존의 모든 드롭다운 메뉴를 숨김

            // 현재 클릭된 채팅방을 선택 상태로 설정
            document.querySelectorAll('.chat_list .chat_room_item').forEach(room => {
                room.removeAttribute('data-selected');
            });
            Item.setAttribute('data-selected', 'true');

            // 드롭다운 메뉴 표시
            dropdownMenu.style.display = 'block';
            dropdownMenu.style.left = `${event.pageX}px`;
            dropdownMenu.style.top = `${event.pageY}px`;

            // 채팅방 나가기
            const chatRoomExit = document.getElementById("chatRoomExit");
            chatRoomExit.onclick = function() {
                const selectedEmpNo = removeEmpNoPrefix(Item.getAttribute('id'));
                openModal(exitChatRoomModal);
                confirmExitRoomButton.onclick = function() {
                    exitChatRoom(empNo, selectedEmpNo);
                    closeModal(exitChatRoomModal);
                }
            };

            // 드롭다운 메뉴 외부 클릭 시 메뉴 닫기
            document.addEventListener('click', function hideDropdownMenuListener(e) {
                if (!dropdownMenu.contains(e.target)) {
                    hideDropdownMenu();
                    document.removeEventListener('click', hideDropdownMenuListener);
                }
            });
        });
    });
}

// 채팅방 나가기 함수
async function exitChatRoom(empNo,selectedEmpNo) {
    try {
        // 서버에 삭제 요청을 보냄
        const response = await fetch(`/chatrooms/exit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senderEmpNo: empNo, recipientEmpNo: selectedEmpNo })
        });

        if (response.ok) {
            // 성공적으로 삭제되면 채팅방 목록에서 제거
            const chatRoomItem = document.getElementById(addEmpNoPrefix(selectedEmpNo));
            if (chatRoomItem) {
                chatRoomItem.remove();
            }
            console.log('채팅방을 성공적으로 나갔습니다.');
            hideDropdownMenu();
            closeChat(); // 채팅창을 닫고 초기화
            if (window.opener) { // 부모 창에 알람 초기화 메시지 전송
                window.opener.postMessage({ type: 'RESET_ALARM', empNo: selectedEmpNo }, '*');
            }
        } else {
            console.error('채팅방을 나가는 중 오류가 발생했습니다.:', response.statusText);
        }
    } catch (error) {
        console.error('채팅방을 나가는 중 오류가 발생했습니다.:', error);
    }
    initializeContextMenu(); // 오른쪽 마우스 클릭: 드롭다운메뉴
}

// 드룹다운 메뉴 숨김
function hideDropdownMenu() {
    const dropDownMenu = document.querySelector('.chat_menu_container .dropdown-menu');
    if (dropDownMenu) {
        dropDownMenu.style.display = 'none';
    }
}

// empNo 접두사 추가 함수
function addEmpNoPrefix(empNo) {
    return `empNo${empNo}`;
}

// empNo 접두사 제거 함수
function removeEmpNoPrefix(empNoWithPrefix) {
    return empNoWithPrefix.replace('empNo', '');
}

// 로그아웃 처리
function onLogout() {
    if (stompClient) {
        stompClient.disconnect();
    }
    alert('로그아웃되었습니다.');
    window.close();
}
