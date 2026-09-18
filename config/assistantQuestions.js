const QUESTION_CATALOG = [
  {
    id: "help",
    label: { en: "Assistant help", hi: "सहायक मदद", mr: "सहाय्यक मदत" },
    keywords: ["help", "question", "what can", "मदद", "सवाल", "प्रश्न", "काय विचारू"],
    questions: {
      en: ["What can you tell me?", "Show all supported questions", "Give me a dashboard summary"],
      hi: ["आप मुझे क्या बता सकते हैं?", "सभी सवालों की सूची दिखाओ", "डैशबोर्ड का सारांश बताओ"],
      mr: ["तुम्ही मला काय सांगू शकता?", "सर्व प्रश्नांची यादी दाखवा", "डॅशबोर्डचा सारांश सांगा"],
    },
  },
  {
    id: "summary",
    label: { en: "Dashboard summary", hi: "डैशबोर्ड सारांश", mr: "डॅशबोर्ड सारांश" },
    keywords: ["summary", "overview", "dashboard", "total", "सारांश", "कुल", "एकूण", "आढावा"],
    questions: {
      en: ["Give me today's summary", "How many tenants are there?", "Show total pending rent", "How many units are occupied?"],
      hi: ["आज का सारांश बताओ", "कुल कितने किरायेदार हैं?", "कुल बकाया किराया कितना है?", "कितनी यूनिट भरी हुई हैं?"],
      mr: ["आजचा सारांश सांगा", "एकूण भाडेकरू किती आहेत?", "एकूण थकीत भाडे किती आहे?", "किती युनिट भरलेल्या आहेत?"],
    },
  },
  {
    id: "tenant_list",
    label: { en: "Tenant list and details", hi: "किरायेदार सूची और विवरण", mr: "भाडेकरू यादी आणि तपशील" },
    keywords: ["tenant", "resident", "customer", "all people", "किरायेदार", "भाडेकरू", "रहिवासी"],
    questions: {
      en: ["Show all tenants", "Show all tenant details", "Find tenant Rahul", "Who lives in room 12?", "Who is in bed 3?", "Show tenant phone numbers"],
      hi: ["सभी किरायेदार दिखाओ", "सभी किरायेदारों का विवरण दिखाओ", "राहुल किरायेदार को खोजो", "कमरा 12 में कौन रहता है?", "बेड 3 में कौन है?", "किरायेदारों के फोन नंबर दिखाओ"],
      mr: ["सर्व भाडेकरू दाखवा", "सर्व भाडेकरूंचे तपशील दाखवा", "राहुल भाडेकरू शोधा", "रूम 12 मध्ये कोण राहते?", "बेड 3 मध्ये कोण आहे?", "भाडेकरूंचे फोन नंबर दाखवा"],
    },
  },
  {
    id: "pending_rent",
    label: { en: "Pending and overdue rent", hi: "बकाया और लंबित किराया", mr: "थकीत आणि प्रलंबित भाडे" },
    keywords: ["pending", "overdue", "due", "outstanding", "बाकी", "बकाया", "थकीत", "प्रलंबित"],
    questions: {
      en: ["Which tenants have pending rent?", "How much rent is overdue?", "Show overdue tenants with room numbers", "Which tenant has the highest due?", "Show pending months for Rahul"],
      hi: ["किन किरायेदारों का किराया बाकी है?", "कितना किराया बकाया है?", "कमरे के नंबर के साथ बकायेदार दिखाओ", "सबसे ज्यादा बकाया किसका है?", "राहुल के लंबित महीने दिखाओ"],
      mr: ["कोणत्या भाडेकरूंचे भाडे थकीत आहे?", "किती भाडे थकीत आहे?", "रूम नंबरसह थकीत भाडेकरू दाखवा", "सर्वाधिक थकबाकी कोणाची आहे?", "राहुलचे प्रलंबित महिने दाखवा"],
    },
  },
  {
    id: "payments",
    label: { en: "Payments and collection", hi: "भुगतान और वसूली", mr: "पेमेंट आणि वसुली" },
    keywords: ["paid", "payment", "received", "collected", "collection", "भुगतान", "जमा", "पेमेंट", "वसुली"],
    questions: {
      en: ["How much rent was collected?", "Show paid tenants", "Who paid this month?", "Show Rahul's last payment", "What is the collection total?"],
      hi: ["कितना किराया जमा हुआ?", "भुगतान करने वाले किरायेदार दिखाओ", "इस महीने किसने भुगतान किया?", "राहुल का आखिरी भुगतान दिखाओ", "कुल वसूली कितनी है?"],
      mr: ["किती भाडे जमा झाले?", "पेमेंट केलेले भाडेकरू दाखवा", "या महिन्यात कोणी पेमेंट केले?", "राहुलचे शेवटचे पेमेंट दाखवा", "एकूण वसुली किती आहे?"],
    },
  },
  {
    id: "vacancy",
    label: { en: "Vacancies and availability", hi: "खाली जगह और उपलब्धता", mr: "रिक्त जागा आणि उपलब्धता" },
    keywords: ["vacant", "empty", "available", "free bed", "खाली", "रिक्त", "उपलब्ध", "मोकळी"],
    questions: {
      en: ["Show all vacant units", "How many beds are available?", "Which rooms are empty?", "Show available beds under 5000", "Is room 12 available?"],
      hi: ["सभी खाली यूनिट दिखाओ", "कितने बेड उपलब्ध हैं?", "कौन से कमरे खाली हैं?", "5000 से कम उपलब्ध बेड दिखाओ", "क्या कमरा 12 उपलब्ध है?"],
      mr: ["सर्व रिक्त युनिट दाखवा", "कितके बेड उपलब्ध आहेत?", "कोणते रूम रिकामे आहेत?", "5000 पेक्षा कमी किमतीचे बेड दाखवा", "रूम 12 उपलब्ध आहे का?"],
    },
  },
  {
    id: "rooms",
    label: { en: "Rooms, beds, and occupancy", hi: "कमरे, बेड और उपयोग", mr: "रूम, बेड आणि वापर" },
    keywords: ["room", "bed", "occupancy", "occupied", "unit", "कमरा", "बेड", "रूम", "युनिट", "भरले"],
    questions: {
      en: ["Show all rooms", "How many rooms are occupied?", "Show room 12 details", "Which bed is assigned to Rahul?", "Show occupancy by property type"],
      hi: ["सभी कमरे दिखाओ", "कितने कमरे भरे हुए हैं?", "कमरा 12 का विवरण दिखाओ", "राहुल को कौन सा बेड मिला है?", "प्रॉपर्टी प्रकार के अनुसार उपयोग दिखाओ"],
      mr: ["सर्व रूम दाखवा", "कितके रूम भरलेले आहेत?", "रूम 12 चा तपशील दाखवा", "राहुलला कोणता बेड दिला आहे?", "प्रॉपर्टी प्रकारानुसार वापर दाखवा"],
    },
  },
  {
    id: "deposit",
    label: { en: "Deposits and joining", hi: "जमा राशि और प्रवेश", mr: "डिपॉझिट आणि प्रवेश" },
    keywords: ["deposit", "joining", "joined", "leave", "security", "जमा", "डिपॉझिट", "प्रवेश", "सुरक्षा"],
    questions: {
      en: ["Show all deposit amounts", "What deposit did Rahul pay?", "Who joined this month?", "Who has left?", "Show tenants without deposit details"],
      hi: ["सभी जमा राशि दिखाओ", "राहुल ने कितनी जमा राशि दी?", "इस महीने कौन शामिल हुआ?", "कौन जा चुका है?", "जिनका जमा विवरण नहीं है उन्हें दिखाओ"],
      mr: ["सर्व डिपॉझिट रक्कम दाखवा", "राहुलने किती डिपॉझिट दिले?", "या महिन्यात कोण सामील झाले?", "कोण निघून गेले?", "डिपॉझिट तपशील नसलेले भाडेकरू दाखवा"],
    },
  },
  {
    id: "bills",
    label: { en: "Bills and utilities", hi: "बिल और उपयोगिताएं", mr: "बिले आणि युटिलिटी" },
    keywords: ["bill", "electricity", "light", "utility", "बिल", "बिजली", "लाइट", "वीज"],
    questions: {
      en: ["How many light bills are pending?", "What is the total pending bill amount?", "Show unpaid bills", "Show this month's electricity details"],
      hi: ["कितने लाइट बिल बाकी हैं?", "कुल बकाया बिल राशि कितनी है?", "बिना भुगतान वाले बिल दिखाओ", "इस महीने की बिजली का विवरण दिखाओ"],
      mr: ["किती लाइट बिले थकीत आहेत?", "एकूण थकीत बिल रक्कम किती आहे?", "न भरलेली बिले दाखवा", "या महिन्याच्या विजेचा तपशील दाखवा"],
    },
  },
  {
    id: "expenses",
    label: { en: "Expenses and reports", hi: "खर्च और रिपोर्ट", mr: "खर्च आणि रिपोर्ट" },
    keywords: ["expense", "cost", "report", "income", "खर्च", "रिपोर्ट", "उत्पन्न", "अहवाल"],
    questions: {
      en: ["Show this month's expenses", "What is the total expense?", "Generate a rent report", "Compare collected rent and expenses"],
      hi: ["इस महीने का खर्च दिखाओ", "कुल खर्च कितना है?", "किराया रिपोर्ट बनाओ", "जमा किराए और खर्च की तुलना करो"],
      mr: ["या महिन्याचा खर्च दाखवा", "एकूण खर्च किती आहे?", "भाडे रिपोर्ट तयार करा", "जमा भाडे आणि खर्चाची तुलना करा"],
    },
  },
  {
    id: "admin",
    label: { en: "Administration", hi: "प्रशासन", mr: "प्रशासन" },
    keywords: ["organization", "subscription", "admin", "plan", "account", "संस्था", "सब्सक्रिप्शन", "प्रशासन", "योजना"],
    questions: {
      en: ["How many organizations are active?", "Which subscriptions are expiring?", "Show pending organization payments", "Show suspended accounts"],
      hi: ["कितनी संस्थाएं सक्रिय हैं?", "कौन से सब्सक्रिप्शन समाप्त होने वाले हैं?", "लंबित संस्था भुगतान दिखाओ", "निलंबित खाते दिखाओ"],
      mr: ["किती संस्था सक्रिय आहेत?", "कोणती सबस्क्रिप्शन संपत आहेत?", "प्रलंबित संस्था पेमेंट दाखवा", "निलंबित खाती दाखवा"],
    },
  },
  {
    id: "tenant_actions",
    label: { en: "Tenant admission and editing", hi: "किरायेदार जोड़ना और बदलना", mr: "भाडेकरू प्रवेश आणि बदल" },
    keywords: ["add tenant", "new tenant", "admission", "edit tenant", "update tenant", "tenant add", "नया tenant", "नवीन tenant", "tenant edit"],
    questions: {
      en: ["Add a new tenant", "What information is required to add a tenant?", "Edit Rahul", "Change Rahul's mobile number", "Enable canteen for Rahul", "Can I add a tenant without canteen?"],
      hi: ["नया tenant add करो", "Tenant add करने के लिए क्या चाहिए?", "राहुल को edit करो", "राहुल का नंबर बदलो", "राहुल के लिए canteen चालू करो"],
      mr: ["नवीन tenant add कर", "Tenant add करायला काय माहिती लागते?", "राहुलला edit कर", "राहुलचा नंबर बदल", "राहुलसाठी canteen सुरू कर"],
    },
  },
  {
    id: "documents",
    label: { en: "Tenant documents", hi: "किरायेदार दस्तावेज", mr: "भाडेकरू कागदपत्रे" },
    keywords: ["document", "aadhaar", "aadhar", "photo", "missing document", "documents", "दस्तावेज", "कागदपत्र", "आधार", "फोटो"],
    questions: {
      en: ["Show Rahul's documents", "Which documents are missing?", "How many tenants have incomplete documents?", "Is Rahul's photo available?", "Show tenants with missing documents"],
      hi: ["राहुल के documents दिखाओ", "किन tenants के documents pending हैं?", "कितने tenants के documents अधूरे हैं?", "राहुल की photo है क्या?"],
      mr: ["राहुलचे documents दाखव", "कोणाचे documents pending आहेत?", "किती tenants चे documents अपूर्ण आहेत?", "राहुलचा photo आहे का?"],
    },
  },
  {
    id: "rent_details",
    label: { en: "Individual rent and history", hi: "व्यक्तिगत किराया और इतिहास", mr: "वैयक्तिक भाडे आणि इतिहास" },
    keywords: ["rent history", "rent status", "last payment", "rent clear", "rent bharla", "rent baki", "किराया इतिहास", "भाडे इतिहास", "भाडे भरले"],
    questions: {
      en: ["Rahul's rent status", "Did Rahul pay September rent?", "Show Rahul's rent history", "Which months are pending for Rahul?", "How much did Rahul pay last time?", "How much does Rahul owe in total?"],
      hi: ["राहुल का rent status बताओ", "क्या राहुल ने सितंबर का rent दिया?", "राहुल की rent history दिखाओ", "राहुल के कौनसे महीने pending हैं?", "राहुल पर कुल कितना बाकी है?"],
      mr: ["राहुलचा rent status सांग", "राहुलने सप्टेंबरचे भाडे भरले का?", "राहुलचा rent history दाखव", "राहुलचे कोणते महिने pending आहेत?", "राहुलचे एकूण किती बाकी आहे?"],
    },
  },
  {
    id: "time_queries",
    label: { en: "Date and period questions", hi: "समय और अवधि प्रश्न", mr: "तारीख आणि कालावधी प्रश्न" },
    keywords: ["today", "yesterday", "this month", "last month", "this year", "september", "august", "आज", "काल", "या महिन्यात", "मागचा महिना"],
    questions: {
      en: ["How much was collected this month?", "Show last month's pending rent", "Show rent collected between 1 Sep and 15 Sep", "Compare August and September collection", "What happened yesterday?"],
      hi: ["इस महीने कितना collection हुआ?", "पिछले महीने का pending rent दिखाओ", "1 सितंबर से 15 सितंबर तक का rent दिखाओ", "अगस्त और सितंबर की तुलना करो"],
      mr: ["या महिन्यात किती collection झाले?", "मागच्या महिन्याचे pending rent दाखव", "1 सप्टेंबर ते 15 सप्टेंबरचे rent दाखव", "ऑगस्ट आणि सप्टेंबरची तुलना कर"],
    },
  },
  {
    id: "payment_actions",
    label: { en: "Payment recording", hi: "भुगतान दर्ज करना", mr: "पेमेंट नोंदणी" },
    keywords: ["record payment", "add payment", "mark paid", "partial payment", "cash payment", "upi", "payment add", "पेमेंट जमा", "भुगतान दर्ज"],
    questions: {
      en: ["Record Rahul's rent", "Rahul paid 5000", "Add partial payment", "Mark September rent paid", "How much should Rahul pay to clear dues?"],
      hi: ["राहुल का payment डालो", "राहुल ने 5000 दिए add करो", "आंशिक payment दर्ज करो", "सितंबर का rent paid करो"],
      mr: ["राहुलने 5000 दिले add कर", "राहुलचे सप्टेंबरचे rent paid कर", "partial payment add कर", "बाकी clear करण्यासाठी किती भरावे?"],
    },
  },
  {
    id: "rent_cycle",
    label: { en: "Rent cycle", hi: "किराया चक्र", mr: "भाडे सायकल" },
    keywords: ["rent cycle", "advance paid", "normal cycle", "advance", "नियमित चक्र", "अॅडव्हान्स", "advance paid"],
    questions: {
      en: ["What is the normal rent cycle?", "Which tenants are advance paid?", "Show normal cycle tenants", "What is Rahul's payment cycle?"],
      hi: ["Normal rent cycle क्या है?", "Advance paid tenants दिखाओ", "Normal cycle वाले tenants दिखाओ", "राहुल का payment cycle क्या है?"],
      mr: ["Normal rent cycle काय आहे?", "Advance paid tenants दाखव", "Normal cycle चे tenants दाखव", "राहुलची payment cycle काय आहे?"],
    },
  },
  {
    id: "occupancy_units",
    label: { en: "Occupancy and property units", hi: "उपयोग और प्रॉपर्टी यूनिट", mr: "ऑक्युपन्सी आणि प्रॉपर्टी युनिट" },
    keywords: ["occupancy", "building", "wing", "floor", "property", "flat", "meter", "इमारत", "विंग", "मजला", "बिल्डिंग"],
    questions: {
      en: ["What is my occupancy?", "Show Building A summary", "How many tenants are in A Wing?", "Show room 101 details", "How many beds are in room 101?", "Show the meter number"],
      hi: ["मेरी occupancy कितनी है?", "Building A का summary दिखाओ", "A Wing में कितने tenants हैं?", "Room 101 का विवरण दिखाओ", "Meter number दिखाओ"],
      mr: ["माझी occupancy किती आहे?", "Building A चा summary दाखव", "A Wing मध्ये किती tenants आहेत?", "Room 101 चा तपशील दाखव", "Meter number दाखव"],
    },
  },
  {
    id: "unit_actions",
    label: { en: "Unit and bed management", hi: "यूनिट और बेड प्रबंधन", mr: "युनिट आणि बेड व्यवस्थापन" },
    keywords: ["add room", "add bed", "add shop", "edit room", "delete room", "change rent", "bed add", "room add", "रूम जोड़", "बेड जोड़", "युनिट"],
    questions: {
      en: ["Add a hostel room", "Add 4 beds to room 101", "Add a shop", "Change room rent", "Update meter reading", "Can I add another bed?"],
      hi: ["Hostel room add करो", "Room 101 में 4 beds जोड़ो", "Shop add करो", "Room rent बदलो", "Meter reading update करो"],
      mr: ["Hostel room add कर", "Room 101 मध्ये 4 beds add कर", "Shop add कर", "Room rent बदल", "Meter reading update कर"],
    },
  },
  {
    id: "shift_leave_former",
    label: { en: "Shift, leave, and former tenants", hi: "शिफ्ट, छुट्टी और पूर्व किरायेदार", mr: "शिफ्ट, सोडणे आणि माजी भाडेकरू" },
    keywords: ["shift", "move", "leaving", "leave date", "checkout", "settlement", "former tenant", "restore", "shift कर", "room छोड़", "निघून"],
    questions: {
      en: ["Shift Rahul to another bed", "Which beds can Rahul shift to?", "Calculate Rahul's leave settlement", "How much deposit should I refund Rahul?", "Show former tenants", "Can Rahul be restored?"],
      hi: ["राहुल को दूसरे bed पर shift करो", "राहुल के लिए खाली bed दिखाओ", "राहुल का settlement निकालो", "कितना deposit refund करना है?", "Former tenants दिखाओ"],
      mr: ["राहुलला दुसऱ्या bed वर shift कर", "राहुलसाठी रिकामे bed दाखव", "राहुलचा settlement काढ", "राहुलला किती deposit परत द्यायचा?", "Former tenants दाखव"],
    },
  },
  {
    id: "deposit_details",
    label: { en: "Deposit and refund", hi: "जमा राशि और वापसी", mr: "डिपॉझिट आणि परतावा" },
    keywords: ["deposit", "refund", "deduct", "security", "जमा राशि", "वापसी", "परतावा", "कपात", "डिपॉझिट"],
    questions: {
      en: ["What is the total deposit held?", "Who has the highest deposit?", "How much deposit remains after deduction?", "Show tenants with zero deposit", "Deduct rent from deposit"],
      hi: ["कुल deposit कितना है?", "सबसे ज्यादा deposit किसका है?", "कटौती के बाद deposit कितना बचता है?", "जिनका deposit zero है दिखाओ"],
      mr: ["एकूण deposit किती आहे?", "सर्वात जास्त deposit कोणाचा आहे?", "कपातीनंतर deposit किती उरतो?", "zero deposit असलेले tenants दाखव"],
    },
  },
  {
    id: "canteen",
    label: { en: "Canteen and meal attendance", hi: "कैंटीन और भोजन उपस्थिति", mr: "कॅन्टीन आणि जेवण उपस्थिती" },
    keywords: ["canteen", "breakfast", "lunch", "dinner", "meal", "attendance", "present", "absent", "कैंटीन", "नाश्ता", "जेवण", "उपस्थिती"],
    questions: {
      en: ["Is canteen enabled?", "What is the breakfast price?", "What is Rahul's canteen plan?", "Today's lunch attendance", "Who is absent?", "How many people had dinner today?"],
      hi: ["क्या canteen चालू है?", "Breakfast की कीमत क्या है?", "राहुल का canteen plan क्या है?", "आज lunch में कितने present हैं?", "कौन absent है?"],
      mr: ["Canteen सुरू आहे का?", "Breakfast ची किंमत किती आहे?", "राहुलचा canteen plan काय आहे?", "आज lunch ला किती present आहेत?", "कोण absent आहे?"],
    },
  },
  {
    id: "staff_expenses",
    label: { en: "Staff and general expenses", hi: "स्टाफ और सामान्य खर्च", mr: "स्टाफ आणि इतर खर्च" },
    keywords: ["expense", "salary", "security", "maintenance", "repair", "supplies", "खर्च", "पगार", "दुरुस्ती", "साहित्य"],
    questions: {
      en: ["Show staff expenses", "What is the total expense this month?", "Show salary expenses", "Add 10000 salary for Ramesh", "Show repair expenses", "Compare staff expenses"],
      hi: ["Staff expenses दिखाओ", "इस महीने का कुल खर्च कितना है?", "Salary expenses दिखाओ", "रमेश की 10000 salary add करो", "Repair expenses दिखाओ"],
      mr: ["Staff expenses दाखव", "या महिन्याचा एकूण खर्च किती आहे?", "Salary expenses दाखव", "रमेशचा 10000 पगार add कर", "Repair expenses दाखव"],
    },
  },
  {
    id: "finance_analysis",
    label: { en: "Financial analysis", hi: "वित्तीय विश्लेषण", mr: "आर्थिक विश्लेषण" },
    keywords: ["profit", "cash flow", "collection minus", "financial", "receivable", "उत्पन्न", "नफा", "आर्थिक", "येणे"],
    questions: {
      en: ["How much did I collect and spend this month?", "Collection minus expenses", "Expected versus collected rent", "How much is still receivable?", "Give me a financial summary"],
      hi: ["इस महीने कितना जमा और खर्च हुआ?", "Collection में से expenses घटाओ", "Expected और collected rent बताओ", "कितना receivable बाकी है?"],
      mr: ["या महिन्यात किती जमा आणि खर्च झाले?", "Collection मधून expenses वजा करा", "Expected आणि collected rent सांगा", "किती receivable बाकी आहे?"],
    },
  },
  {
    id: "wallet_referral_subscription",
    label: { en: "Wallet, referral, and subscription", hi: "वॉलेट, रेफरल और सब्सक्रिप्शन", mr: "वॉलेट, रेफरल आणि सबस्क्रिप्शन" },
    keywords: ["wallet", "coins", "referral", "subscription", "plan", "renew", "upgrade", "quota", "वॉलेट", "कॉइन", "रेफरल", "सब्सक्रिप्शन"],
    questions: {
      en: ["What is my wallet balance?", "Show wallet history", "What is my referral code?", "What is my current plan?", "When does my subscription expire?", "How many beds can I add?"],
      hi: ["मेरे wallet में कितने coins हैं?", "Wallet history दिखाओ", "मेरा referral code क्या है?", "मेरा current plan क्या है?", "Subscription कब expire होगा?"],
      mr: ["माझ्या wallet मध्ये किती coins आहेत?", "Wallet history दाखव", "माझा referral code काय आहे?", "माझा current plan काय आहे?", "Subscription कधी संपते?"],
    },
  },
  {
    id: "reports_navigation_help",
    label: { en: "Reports, navigation, and help", hi: "रिपोर्ट, नेविगेशन और मदद", mr: "रिपोर्ट, नेव्हिगेशन आणि मदत" },
    keywords: ["report", "export", "download", "open", "go to", "how do i", "why can't", "report", "दिखाओ", "खोलो", "कैसे", "कसे"],
    questions: {
      en: ["Give me a vacancy report", "Export the tenant list", "Open payments", "How do I add a tenant?", "Why is no vacancy showing?", "Why can't I add a shop?"],
      hi: ["Vacancy report दो", "Tenant list export करो", "Payments खोलो", "Tenant कैसे add करें?", "Vacancy क्यों नहीं दिख रही?"],
      mr: ["Vacancy report दे", "Tenant list export कर", "Payments उघड", "Tenant कसा add करायचा?", "Vacancy का दिसत नाही?"],
    },
  },
  {
    id: "import_export",
    label: { en: "Import and export", hi: "आयात और निर्यात", mr: "इम्पोर्ट आणि एक्सपोर्ट" },
    keywords: ["import", "export", "excel", "template", "download tenant", "spreadsheet", "आयात", "निर्यात", "एक्सेल", "टेम्पलेट"],
    questions: {
      en: ["How do I import tenants?", "Download tenant import template", "What columns are required?", "Why did my tenant import fail?", "Export tenants to Excel"],
      hi: ["Tenants import कैसे करें?", "Tenant import template download करो", "कौनसे columns चाहिए?", "Tenant import क्यों fail हुआ?", "Tenants Excel में export करो"],
      mr: ["Tenants import कसे करायचे?", "Tenant import template download कर", "कोणते columns लागतात?", "Tenant import fail का झाले?", "Tenants Excel मध्ये export कर"],
    },
  },
  {
    id: "building_filters",
    label: { en: "Building, wing, and floor analysis", hi: "बिल्डिंग, विंग और फ्लोर विश्लेषण", mr: "बिल्डिंग, विंग आणि मजला विश्लेषण" },
    keywords: ["building wise", "wing wise", "floor wise", "building a", "a wing", "first floor", "second floor", "बिल्डिंग", "विंग", "मजला"],
    questions: {
      en: ["Show A Wing tenants who haven't paid", "How many vacant beds are in A Wing?", "A Wing pending rent", "Which floor has most vacancies?", "Which building has most pending rent?"],
      hi: ["A Wing में जिनका rent pending है दिखाओ", "A Wing में कितने beds खाली हैं?", "A Wing का pending rent बताओ", "किस floor पर सबसे ज्यादा vacancy है?"],
      mr: ["A Wing मधले rent न भरलेले tenants दाखव", "A Wing मध्ये किती beds रिकामे आहेत?", "A Wing चे pending rent सांग", "कोणत्या floor वर सर्वाधिक vacancy आहे?"],
    },
  },
  {
    id: "combined_filters",
    label: { en: "Combined and analytical questions", hi: "संयुक्त और विश्लेषणात्मक प्रश्न", mr: "संयुक्त आणि विश्लेषणात्मक प्रश्न" },
    keywords: ["above", "below", "highest", "most", "compare", "all pending", "who has", "जिनका", "से अधिक", "सर्वाधिक", "तुलना"],
    questions: {
      en: ["Show vacant beds below 6000", "Show tenants with pending rent above 10000", "Show tenants leaving this month who owe rent", "Which building has the most vacant beds?", "How much will I receive if all pending rent is collected?"],
      hi: ["6000 से कम खाली beds दिखाओ", "10000 से ज्यादा pending rent वाले tenants दिखाओ", "इस महीने जाने वाले और बकायेदार tenants दिखाओ", "किस building में सबसे ज्यादा beds खाली हैं?"],
      mr: ["6000 पेक्षा कमी रिकामे beds दाखव", "10000 पेक्षा जास्त pending rent असलेले tenants दाखव", "या महिन्यात जाणारे आणि rent बाकी असलेले tenants दाखव", "कोणत्या building मध्ये सर्वाधिक beds रिकामे आहेत?"],
    },
  },
  {
    id: "navigation",
    label: { en: "App navigation", hi: "ऐप नेविगेशन", mr: "अॅप नेव्हिगेशन" },
    keywords: ["open", "go to", "navigate", "profile", "उघड", "खोलो", "दाखव", "जा", "नेव्हिगेशन"],
    questions: {
      en: ["Open tenants", "Go to payments", "Open vacant units", "Open Rahul's profile", "Go to canteen attendance", "Open expenses"],
      hi: ["Tenants खोलो", "Payments पर जाओ", "Vacant units खोलो", "राहुल की profile खोलो", "Canteen attendance खोलो"],
      mr: ["Tenants उघड", "Payments वर जा", "Vacant units उघड", "राहुलची profile उघड", "Canteen attendance उघड"],
    },
  },
  {
    id: "troubleshooting",
    label: { en: "Errors and troubleshooting", hi: "त्रुटि और समाधान", mr: "त्रुटी आणि उपाय" },
    keywords: ["why", "error", "failed", "not loading", "can't", "problem", "का", "त्रुटी", "फेल", "लोड", "अडचण"],
    questions: {
      en: ["Why can't I add a tenant?", "Why is no vacancy showing?", "Why is rent not showing?", "Why can't I shift Rahul?", "Why is canteen attendance empty?", "Payment failed"],
      hi: ["Tenant add क्यों नहीं हो रहा?", "Vacancy क्यों नहीं दिख रही?", "Rent क्यों नहीं दिख रहा?", "Rahul को shift क्यों नहीं कर सकता?", "Payment fail क्यों हुआ?"],
      mr: ["Tenant add का होत नाही?", "Vacancy का दिसत नाही?", "Rent का दिसत नाही?", "राहुलला shift का करता येत नाही?", "Payment fail का झाले?"],
    },
  },
  {
    id: "conversation",
    label: { en: "Conversation and follow-up", hi: "बातचीत और फॉलो-अप", mr: "संभाषण आणि फॉलो-अप" },
    keywords: ["hi", "hello", "thanks", "thank you", "cancel", "confirm", "his", "her", "त्याचा", "उसका", "नमस्कार"],
    questions: {
      en: ["Hi", "What can you do?", "Thanks", "Cancel that", "Confirm payment", "Show Rahul, then his rent"],
      hi: ["नमस्ते", "आप क्या कर सकते हैं?", "धन्यवाद", "इसे रद्द करो", "भुगतान confirm करो", "राहुल को दिखाओ फिर उसका rent"],
      mr: ["नमस्कार", "तुम्ही काय करू शकता?", "धन्यवाद", "ते रद्द कर", "पेमेंट confirm कर", "राहुलला दाखव मग त्याचा rent"],
    },
  },
];

function allQuestions() {
  return QUESTION_CATALOG.flatMap((category) => [
    ...category.questions.en,
    ...category.questions.hi,
    ...category.questions.mr,
  ]);
}

function findQuestionCategories(question = "") {
  const normalized = question.toLowerCase();
  const matches = QUESTION_CATALOG.filter((category) =>
    category.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
  );
  return matches.length ? matches : [QUESTION_CATALOG.find((category) => category.id === "summary")];
}

function contextualQuestions(question = "", limit = 6) {
  return findQuestionCategories(question)
    .flatMap((category) => category.questions.en.slice(0, 2))
    .slice(0, limit);
}

function catalogResponse() {
  return QUESTION_CATALOG.map((category) => ({
    id: category.id,
    label: category.label,
    questions: category.questions,
  }));
}

module.exports = {
  QUESTION_CATALOG,
  allQuestions,
  catalogResponse,
  contextualQuestions,
  findQuestionCategories,
};
