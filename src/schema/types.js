// The parts of the schema.org type hierarchy that the structured data rules need, so a
// "Plumber" is held to the LocalBusiness requirements, a "BlogPosting" to Article's and a
// "MusicEvent" to Event's. Each entry lists direct and indirect children; the lookup below
// follows the chains, so a type listed under LocalBusiness also counts as Organization and Place.

const LOCAL_BUSINESS = [
  "AnimalShelter", "ArchiveOrganization", "AutomotiveBusiness", "AutoBodyShop", "AutoDealer",
  "AutoPartsStore", "AutoRental", "AutoRepair", "AutoWash", "GasStation", "MotorcycleDealer",
  "MotorcycleRepair", "ChildCare", "Dentist", "DryCleaningOrLaundry", "EmergencyService",
  "FireStation", "Hospital", "PoliceStation", "EmploymentAgency", "EntertainmentBusiness",
  "AdultEntertainment", "AmusementPark", "ArtGallery", "Casino", "ComedyClub", "MovieTheater",
  "NightClub", "FinancialService", "AccountingService", "AutomatedTeller", "BankOrCreditUnion",
  "InsuranceAgency", "FoodEstablishment", "Bakery", "BarOrPub", "Brewery", "CafeOrCoffeeShop",
  "Distillery", "FastFoodRestaurant", "IceCreamShop", "Restaurant", "Winery", "GovernmentOffice",
  "PostOffice", "HealthAndBeautyBusiness", "BeautySalon", "DaySpa", "HairSalon", "HealthClub",
  "NailSalon", "TattooParlor", "HomeAndConstructionBusiness", "Electrician", "GeneralContractor",
  "HVACBusiness", "HousePainter", "Locksmith", "MovingCompany", "Plumber", "RoofingContractor",
  "InternetCafe", "LegalService", "Attorney", "Notary", "Library", "LodgingBusiness",
  "BedAndBreakfast", "Campground", "Hostel", "Hotel", "Motel", "Resort", "SkiResort",
  "VacationRental", "MedicalBusiness", "CommunityHealth", "DiagnosticLab", "MedicalClinic",
  "Optician", "Pharmacy", "Physician", "IndividualPhysician", "PhysiciansOffice", "ProfessionalService",
  "RadioStation", "RealEstateAgent", "RecyclingCenter", "SelfStorage", "ShoppingCenter",
  "SportsActivityLocation", "BowlingAlley", "ExerciseGym", "GolfCourse", "PublicSwimmingPool",
  "SkiResort", "SportsClub", "StadiumOrArena", "TennisComplex", "Store", "AutoPartsStore",
  "BikeStore", "BookStore", "ClothingStore", "ComputerStore", "ConvenienceStore", "DepartmentStore",
  "ElectronicsStore", "Florist", "FurnitureStore", "GardenStore", "GroceryStore", "HardwareStore",
  "HobbyShop", "HomeGoodsStore", "JewelryStore", "LiquorStore", "MensClothingStore",
  "MobilePhoneStore", "MovieRentalStore", "MusicStore", "OfficeEquipmentStore", "OutletStore",
  "PawnShop", "PetStore", "ShoeStore", "SportingGoodsStore", "TireShop", "ToyStore",
  "WholesaleStore", "TelevisionStation", "TouristInformationCenter", "TravelAgency",
];

const ARTICLE = [
  "AdvertiserContentArticle", "NewsArticle", "AnalysisNewsArticle", "AskPublicNewsArticle",
  "BackgroundNewsArticle", "OpinionNewsArticle", "ReportageNewsArticle", "ReviewNewsArticle",
  "Report", "SatiricalArticle", "ScholarlyArticle", "MedicalScholarlyArticle",
  "SocialMediaPosting", "BlogPosting", "LiveBlogPosting", "DiscussionForumPosting", "TechArticle",
  "APIReference",
];

// HowToStep is also a ListItem on schema.org, but a step does not carry the position and name
// that a breadcrumb entry needs, so that link is left out to keep recipes from being reported.
const BUILT_IN_SUBTYPES = {
  LocalBusiness: LOCAL_BUSINESS,
  Article: ARTICLE,
  Organization: [
    "LocalBusiness", "Airline", "Consortium", "Corporation", "EducationalOrganization", "FundingScheme",
    "GovernmentOrganization", "LibrarySystem", "MedicalOrganization", "NGO", "NewsMediaOrganization",
    "OnlineBusiness", "PerformingGroup", "PoliticalParty", "Project", "ResearchOrganization",
    "SearchRescueOrganization", "SportsOrganization", "WorkersUnion",
  ],
  EducationalOrganization: ["CollegeOrUniversity", "ElementarySchool", "HighSchool", "MiddleSchool", "Preschool", "School"],
  MedicalOrganization: ["Dentist", "DiagnosticLab", "Hospital", "MedicalClinic", "Pharmacy", "Physician", "VeterinaryCare"],
  OnlineBusiness: ["OnlineStore"],
  PerformingGroup: ["DanceGroup", "MusicGroup", "TheaterGroup"],
  Project: ["FundingAgency", "ResearchProject"],
  SportsOrganization: ["SportsTeam"],
  Place: [
    "LocalBusiness", "Accommodation", "AdministrativeArea", "CivicStructure", "Landform",
    "LandmarksOrHistoricalBuildings", "Residence", "TouristAttraction", "TouristDestination",
  ],
  Accommodation: ["Apartment", "CampingPitch", "House", "Room", "Suite", "SingleFamilyResidence", "HotelRoom", "MeetingRoom"],
  AdministrativeArea: ["City", "Country", "SchoolDistrict", "State"],
  CivicStructure: [
    "Airport", "Aquarium", "Beach", "BoatTerminal", "Bridge", "BusStation", "BusStop", "Campground",
    "Cemetery", "Crematorium", "EducationalOrganization", "EventVenue", "FireStation", "GovernmentBuilding",
    "Hospital", "MovieTheater", "Museum", "MusicVenue", "Park", "ParkingFacility", "PerformingArtsTheater",
    "PlaceOfWorship", "Playground", "PoliceStation", "PublicToilet", "RVPark", "StadiumOrArena",
    "SubwayStation", "TaxiStand", "TrainStation", "Zoo",
  ],
  GovernmentBuilding: ["CityHall", "Courthouse", "DefenceEstablishment", "Embassy", "LegislativeBuilding"],
  PlaceOfWorship: ["BuddhistTemple", "Church", "CatholicChurch", "HinduTemple", "Mosque", "Synagogue"],
  Landform: ["BodyOfWater", "Continent", "Mountain", "Volcano"],
  BodyOfWater: ["Canal", "LakeBodyOfWater", "OceanBodyOfWater", "Pond", "Reservoir", "RiverBodyOfWater", "SeaBodyOfWater", "Waterfall"],
  Residence: ["ApartmentComplex", "GatedResidenceCommunity"],
  CreativeWork: [
    "Article", "Blog", "Book", "Clip", "Comment", "Course", "CreativeWorkSeries", "Dataset", "Episode",
    "Guide", "HowTo", "MediaObject", "Movie", "MusicRecording", "Photograph", "Review",
    "SoftwareApplication", "SoftwareSourceCode", "WebContent", "WebPage", "WebPageElement", "WebSite",
  ],
  Comment: ["Answer", "Question"],
  WebPage: [
    "AboutPage", "CheckoutPage", "CollectionPage", "ContactPage", "FAQPage", "ItemPage", "MedicalWebPage",
    "ProfilePage", "QAPage", "RealEstateListing", "SearchResultsPage",
  ],
  CollectionPage: ["MediaGallery", "ImageGallery", "VideoGallery"],
  MediaObject: ["AudioObject", "Audiobook", "DataDownload", "ImageObject", "Barcode", "MusicVideoObject", "TextObject", "VideoObject", "3DModel"],
  HowTo: ["Recipe"],
  SoftwareApplication: ["MobileApplication", "VideoGame", "WebApplication"],
  Review: ["ClaimReview", "CriticReview", "EmployerReview", "MediaReview", "Recommendation", "UserReview", "ReviewNewsArticle"],
  Event: [
    "BusinessEvent", "ChildrensEvent", "ComedyEvent", "CourseInstance", "DanceEvent", "DeliveryEvent",
    "EducationEvent", "EventSeries", "ExhibitionEvent", "Festival", "FoodEvent", "Hackathon", "LiteraryEvent",
    "MusicEvent", "PublicationEvent", "BroadcastEvent", "OnDemandEvent", "SaleEvent", "ScreeningEvent",
    "SocialEvent", "SportsEvent", "TheaterEvent", "VisualArtsEvent",
  ],
  Product: ["IndividualProduct", "ProductCollection", "ProductGroup", "ProductModel", "SomeProducts", "Vehicle", "BusOrCoach", "Car", "Motorcycle", "MotorizedBicycle"],
  Offer: ["AggregateOffer", "OfferForLease", "OfferForPurchase"],
  Rating: ["AggregateRating", "EmployerAggregateRating", "EndorsementRating"],
  AggregateRating: ["EmployerAggregateRating"],
  ItemList: ["BreadcrumbList", "OfferCatalog"],
};

// Every type below each parent, following chains such as Organization > LocalBusiness > Plumber.
const descendants = new Map();
function collectBelow(parent, into, seen) {
  for (const child of BUILT_IN_SUBTYPES[parent] ?? []) {
    into.add(child);
    if (Object.hasOwn(BUILT_IN_SUBTYPES, child) && !seen.has(child)) {
      seen.add(child);
      collectBelow(child, into, seen);
    }
  }
}
for (const parent of Object.keys(BUILT_IN_SUBTYPES)) {
  const below = new Set();
  collectBelow(parent, below, new Set([parent]));
  descendants.set(parent, below);
}

// `extra` is the user's optional { Parent: ["Child", ...] } map. A type placed under a parent
// there counts as that parent and as everything the parent counts as.
export function isTypeOrSubtype(type, parent, extra = {}, seen = new Set()) {
  if (type === parent || descendants.get(parent)?.has(type)) return true;
  for (const [userParent, children] of Object.entries(extra)) {
    if (!Array.isArray(children) || !children.includes(type) || seen.has(userParent)) continue;
    seen.add(userParent);
    if (isTypeOrSubtype(userParent, parent, extra, seen)) return true;
  }
  return false;
}

export function matchesAny(types, parents, extra = {}) {
  return types.some((type) => parents.some((parent) => isTypeOrSubtype(type, parent, extra)));
}

// Broad kinds of thing. A node cannot be both a Person and an Organization, or both an
// Organization and a WebSite. Some pairs do combine: a LocalBusiness is an Organization and a
// Place, and a Book or an app is often typed as a Product as well.
const KINDS = ["Person", "Organization", "Place", "Event", "Product", "CreativeWork", "Offer", "Rating", "ItemList"];
const COMBINABLE = new Set(["Organization Place", "CreativeWork Product"]);

function kindsOf(types) {
  return KINDS.filter((kind) => types.some((type) => isTypeOrSubtype(type, kind)));
}

// True when two type lists cannot describe the same thing. Unknown types never conflict.
export function typesConflict(a, b) {
  const first = kindsOf(a);
  const second = kindsOf(b);
  if (first.length === 0 || second.length === 0 || first.some((kind) => second.includes(kind))) return false;
  return !first.some((x) => second.some((y) => COMBINABLE.has([x, y].sort().join(" "))));
}
