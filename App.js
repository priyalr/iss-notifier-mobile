// from: https://reactnative.dev/docs/network

// import statements
import React, {Component} from 'react';
import {ActionSheetIOS, ActivityIndicator, FlatList, SafeAreaView, StatusBar, StyleSheet, Text, View} from 'react-native';

import { NavigationContainer, DefaultTheme, DarkTheme} from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import moment from 'moment';
import tz from 'moment-timezone';
import Geolocation from '@react-native-community/geolocation';
import { Button } from 'react-native-elements';
import Icon from 'react-native-vector-icons/Ionicons';
import PushNotificationIOS from "@react-native-community/push-notification-ios";
import AsyncStorage from '@react-native-community/async-storage';
import * as geolib from 'geolib';
import * as Constants from './constants/SightingLocations';

const getData = async (value) => {
  try {
    // Get notification set status from AsyncStorage
    let jsonValue = await AsyncStorage.getItem(value)
    let parsed = JSON.parse(jsonValue)
    let notifValue = jsonValue != null ? parsed.valueNotif : false;

    return notifValue

  } catch(e) {
    // error reading value
    return null
  }
};

const parseString = require('react-native-xml2js').parseString;        

class PassesList extends Component {
  constructor(props) {
    super(props);

    this.state = {
      data: [],
      isLoading: true,
      currentLongitude: 'unknown', //Initial Longitude
      currentLatitude: 'unknown', //Initial Latitude
      currentLocation: 'unknown', //Initial Location
    };
  };

  fetchLocationSightings = async () => {

    // Fetch data from spotthestation website for the user's current location (automatically detected)
    const nasaResponse = await fetch(`https://spotthestation.nasa.gov/sightings/xml_files/${this.state.currentLocation}.xml`);
    const xml = await nasaResponse.text();
    const sightings = await new Promise(resolve => {
      parseString(xml, async function (err, result) {
        // alert(JSON.stringify(result));
        /**
         * "Date"
         * "Time"
         * "Duration"
         * "Maximum Approach"
         * "Departure"
         */
        const responseData = result.rss.channel[0].item
          // Only keep ISS sightings
          .filter(e => e.title[0].includes('ISS Sighting'))
          // The actual data is in the description
          .map(e => e.description[0])
          // CLean up and parse description to get the values
          .map(e => {
            const properties = e
              .split(' <br/>\n\t\t\t\t')
              .map(e2 => e2.replace('\n\t\t\t\t', ''))
              .map(e2 => e2.split(': '))
              .filter(e2 => e2[0] !== '')
              // alternative: .reduce((a, e2) => ({...a, [e2[0]]: e2[1]}), {})
              .reduce((a, e2) => {
                // e2[0] is the key (Date, Time, Duration, etc.)
                a[e2[0]] = e2[1];
                return a;
              }, {});
            return properties;
          })
          // Only keep sightings that are longer than 1 minute
          .filter(e => e.Duration.replace('For', '').replace('minutes', '') > 1)
          // Add notification state to each sighting
          .map(e => ({ ...e, hasSetNotification: false }))
          // Filters for sightings in the last day
          .filter(e => new Date(e.Date) - new Date((Date.now() - 86400 * 1000))  > 0);
         
        // Get data from AsyncStorage about whether the notifcation was previously set/cancelled  
        const responseDataWithNotification = await Promise
          .all(responseData
            .map(async e => ({
              ...e,
              hasSetNotification: await getData(e.Date + ' ' + e.Time) || false,
            })
            )
          );

        resolve(responseDataWithNotification);
      });
    });
    // Set sigthings as the final data and mark data as loaded
    this.setState({sightings, isLoading: false});
    };

  async componentDidMount() {

    // Request permission to send push notifications
    PushNotificationIOS.requestPermissions();

    // Request permission to get location
    Geolocation.requestAuthorization();

    // Indicate loading in progress
    this.setState({isLoading: true});

    //  Get current location of the user
    //  Find the closest sighting point for spotthestation
    const userLoc = await Geolocation.getCurrentPosition(
      (position) => {
        //get the lat and long from the location json
        const currentLongitude = JSON.stringify(position.coords.longitude);
        const currentLatitude = JSON.stringify(position.coords.latitude);

        //set state lat and long, useful in case you want to re-render the text later
        this.setState({ currentLongitude:currentLongitude });
        this.setState({ currentLatitude:currentLatitude });

        // Map coordinates of each sighting point for spotthestation
        const closest = Constants.sightingLocationsData.map((station) => {
          const lat = station.Lat
          const lng = station.Long
          // Parameter required for xml
          const coordSightingLoc = station.Country + '_' +
                                    station.State + '_' +
                                    station.City 

          // Lat, long, key for each sighting point                                              
          const coord = {lat, lng, coordSightingLoc}
          // Calculate distance from current location the sighting point
          return { coord, dist: geolib.getDistance(position.coords, coord) }
        })
        // sorting by distance, [0] returns the closest sighting point (least distance)
        .sort( (a, b) => a.dist - b.dist )[0]
        
        // Get sighting data using fetchLocationSightings for the closest sighting point
        const currentLocation = closest.coord.coordSightingLoc;
        this.setState({currentLocation: currentLocation}
                      ,() => this.fetchLocationSightings()
                     );       

      },
      (error) => alert(error.message),
      { 
         enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 
      }
   );

  }

  render() {
    // Set status bar to light so it can be seen on top of the blue
    StatusBar.setBarStyle('light-content', true);

    // Get data
    const { data, isLoading, sightings } = this.state;

    const scheduleLocalNotification = async (sightingKey) => {
      // Notify 15 minutes before the sighting
      //fireDate: new Date(moment(sightingKey) - 900 * 1000).toISOString(),
      // Notify 5 seconds after now - useful for debugging
      //fireDate: new Date(Date.now() + 5 * 1000).toISOString(),

      // Schedule a notification 15 minutes before the sighting
      // Keep the sighting key in the user info, useful to access later, e.g. cancelling
      await PushNotificationIOS.scheduleLocalNotification({
        alertTitle: 'Sighting Reminder',
        alertBody: "Don't forget the opportunity view the ISS soon!",
        fireDate: new Date(moment(sightingKey) - 900 * 1000).toISOString(),
        applicationIconBadgeNumber: 0,
        userInfo: {key: sightingKey},
      });
    };

    const cancelLocalNotification = async (sightingKey) => {
      // Cancel notification for the sighting
      await PushNotificationIOS.cancelLocalNotifications({
        key: sightingKey,
      })
    };

  
    const storeData = async (value) => {
      // Save notification status in AsyncStorage
      try {
        let obj = {
          valueNotif: value.hasSetNotification,
        }
        const jsonValue = JSON.stringify(obj)
        // Use Date Time as the key
        await AsyncStorage.setItem(value.Date + ' ' + value.Time, jsonValue)
      } catch (e) {
        // saving error
        return null
      }
    };

    const toggleNotificationForSighting = (sightingItem) => () => {

      if (sightingItem.hasSetNotification) {
        // If a notification is already set, pressing the button cancels it
        cancelLocalNotification(sightingItem.Date + ' ' + sightingItem.Time)
      } else {
        // If a notification isn't set, toggle by setting one
        scheduleLocalNotification(sightingItem.Date + ' ' + sightingItem.Time)
      }

      // Update sighting notification state by toggling the value
      sightingItem.hasSetNotification = !sightingItem.hasSetNotification;

      // Get data related to the sighting item
      this.setState({
        sightings: this.state.sightings.map(e => {
          if (e.Date + ' ' + e.Time === sightingItem.Date + ' ' + sightingItem.Time) {
            return sightingItem;
          }
          return e;
        })
      });

      // Save data in AsyncStorage
      storeData(sightingItem)

    };

    return (
      <SafeAreaView style={styles.safearea}>
        <View style={styles.container}>
          {isLoading ? <ActivityIndicator/> : (
            <FlatList
              style={styles.list}
              data={sightings}
              keyExtractor={({ id }, index) => id}
              renderItem={({ item }) => (
                <View style={styles.sighting}>
                  <View style={styles.dateHeader}>
                    {/*Date*/}
                    <Text style={styles.dateItem}>{moment(item.Date).tz('Australia/Sydney').format("D")  }</Text>
                    {/*Name of the day and grey header line*/}
                    <View style={styles.dateLine}>
                      <Text style={styles.dateLine}>{moment(item.Date).tz('Australia/Sydney').format("dddd")  }</Text>
                    </View> 
                  </View>              
                  <View style={styles.row}>
                    <View style={styles.timeContainer}>
                      {/*Start Time*/}
                      <Text style={styles.timeItemBold}>{item.Time}</Text> 
                      {/*Calculate time when it ends*/}
                      <Text style={styles.timeItem}> 
                        {moment(item.Time, ["h:mm A"])
                        .add(item.Duration.split(" ")[0], "minutes")
                        .format("h:mm a")
                        .toUpperCase()}
                      </Text>
                    </View>
                    {/*Blue divider bar between time and info*/}
                    <View style={styles.timeBar}></View> 
                    {/*Sighting detail - duration and approach from*/}
                    <View style={styles.body}>
                      <Text style={{fontWeight: "bold", fontSize: 16}}>For {item.Duration}</Text>
                      <Text style={{color: "#505050", fontSize: 16}}>Appears {item.Approach}</Text>
                    </View> 
                    {/*Bell icon to set and cancel notifications*/}
                    <View style={styles.buttonView}>
                      <Button
                        type="clear"
                        icon={
                          <Icon
                            name={item.hasSetNotification ? "ios-notifications" : "ios-notifications-off"}
                            size={30}
                            color={item.hasSetNotification ? "#0D327C" : "#A9A9A9"}
                          />
                        }
                        onPress={toggleNotificationForSighting(item)}
                      />
                    </View>
                  </View>
                </View>
              )}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }
};

// Set theme colours for the app
const ISSNotifierTheme = {
  dark: false,
  colors: {
    primary: 'rgb(13, 50, 124)',
    background: 'rgb(242, 242, 242)',
    card: 'rgb(13, 50, 124)',
    text: 'rgb(255, 255, 255)',
    border: 'rgb(199, 199, 204)',
  },
};

// Navigation
const Stack = createStackNavigator();
export default function App() {
  return (
    <NavigationContainer theme={ISSNotifierTheme}>
      <Stack.Navigator>
        <Stack.Screen 
          name="Sighting Opportunities"
          component={PassesList} 
          />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// Formatting how the app looks and layout
const styles = StyleSheet.create({
  safearea: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',  
  },
  container: {
    flex: 1,
    flexDirection: 'column',
    width: '100%',
    alignItems: 'center',
    padding: 0,
  },
  locationIndicator: {
    width: '100%',
    height: '5%',
    backgroundColor: "#0D327C",
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationText: {
    color: "#FFF",
    alignContent: 'center',
    fontSize: 15,
  },
  list: {
    width: '100%',
    paddingHorizontal: 24,
  },
  sighting: {
    marginTop: 20,
  },
  row: {
    flex: 1,
    padding: 5,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dateHeader: {
    justifyContent: "flex-start",
    flexDirection: "row",
  },
  dateItem: {
    fontWeight: "bold",
    color: "#4C4C4C",
    fontSize: 22,
    paddingEnd: 3,
    flex: 1
  },
  dateLine: {
    fontWeight: "bold",
    fontSize: 18,
    color: "#808080",
    borderTopWidth: 1,
    borderTopColor: "#808080",
    flex: 9.8
  },
  timeContainer: {
    flex: 2,
    paddingEnd: 1,
  },
  timeItemBold: {
    fontWeight: "bold",
    color: "#0D327C",
    paddingBottom: 4,
  },
  timeItem: {
    color: "#0D327C",
    paddingBottom: 4,
  },  
  timeBar: {
    borderWidth: 3,
    borderColor: "#0D327C",
  },
  body: {
    paddingLeft: 10,
    flex: 6,
  },
  buttonView: {
    flex: 1,
  },
  changeButtonText: {
    alignItems: 'center',
    justifyContent: 'center',
    // fontWeight: 'bold',
    fontSize: 16,
    color: "#FFF",
    paddingEnd: 15,
  },
});